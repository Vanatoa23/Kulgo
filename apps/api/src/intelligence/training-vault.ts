import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  TRAINING_VAULT_DATASET_PLANE,
  TRAINING_VAULT_DATASET_SCHEMAS,
  type TrainingVaultDataset,
  type TrainingVaultPlane,
  type TrainingVaultRecordMap,
} from "@kulgo/shared";

export interface TrainingVaultWriteOptions {
  batchId?: string;
  recordedAt?: Date;
}

export interface TrainingVaultWriteResult {
  key: string;
  recordCount: number;
  bytesWritten: number;
  skipped?: boolean;
}

export interface TrainingVaultSink {
  readonly kind: "noop" | "local_fs" | "s3";
  writeBatch<D extends TrainingVaultDataset>(
    dataset: D,
    records: readonly TrainingVaultRecordMap[D][],
    options?: TrainingVaultWriteOptions,
  ): Promise<TrainingVaultWriteResult>;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function extractPublisherDomain(rawUrl: string): string {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host.replace(/^www\./, "") || "unknown";
  } catch {
    return "unknown";
  }
}

function sanitizeBatchId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 96);
  return cleaned.length > 0 ? cleaned : `batch-${Date.now()}`;
}

export function generateBatchId(prefix = "batch"): string {
  return `${sanitizeBatchId(prefix)}-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

export function buildTrainingVaultKey(params: {
  plane: TrainingVaultPlane;
  dataset: TrainingVaultDataset;
  batchId: string;
  recordedAt?: Date;
}): string {
  const date = params.recordedAt ?? new Date();
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const safeBatchId = sanitizeBatchId(params.batchId);
  return `training-vault/v1/${params.plane}/${params.dataset}/year=${year}/month=${month}/day=${day}/${safeBatchId}.jsonl.gz`;
}

/**
 * Validates every record against its `.strict()` Zod schema before serializing
 * to UTF-8 JSON Lines and compressing with gzip. Throws immediately if any
 * forbidden/unexpected field or copyright invariant violation is present.
 */
export function serializeRecordsToJsonlGzip<D extends TrainingVaultDataset>(
  dataset: D,
  records: readonly TrainingVaultRecordMap[D][],
): Buffer {
  const schema = TRAINING_VAULT_DATASET_SCHEMAS[dataset];
  const lines = records.map((record) => {
    const validated = schema.parse(record);
    return JSON.stringify(validated);
  });
  const payload = `${lines.join("\n")}\n`;
  return gzipSync(Buffer.from(payload, "utf8"));
}

export class NoopTrainingVaultSink implements TrainingVaultSink {
  readonly kind = "noop" as const;

  async writeBatch<D extends TrainingVaultDataset>(
    dataset: D,
    records: readonly TrainingVaultRecordMap[D][],
    options?: TrainingVaultWriteOptions,
  ): Promise<TrainingVaultWriteResult> {
    const plane = TRAINING_VAULT_DATASET_PLANE[dataset];
    const key = buildTrainingVaultKey({
      plane,
      dataset,
      batchId: options?.batchId ?? generateBatchId(dataset),
      recordedAt: options?.recordedAt,
    });
    return {
      key,
      recordCount: records.length,
      bytesWritten: 0,
      skipped: true,
    };
  }
}

export class LocalFsTrainingVaultSink implements TrainingVaultSink {
  readonly kind = "local_fs" as const;
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = resolve(baseDir);
  }

  async writeBatch<D extends TrainingVaultDataset>(
    dataset: D,
    records: readonly TrainingVaultRecordMap[D][],
    options?: TrainingVaultWriteOptions,
  ): Promise<TrainingVaultWriteResult> {
    const plane = TRAINING_VAULT_DATASET_PLANE[dataset];
    const key = buildTrainingVaultKey({
      plane,
      dataset,
      batchId: options?.batchId ?? generateBatchId(dataset),
      recordedAt: options?.recordedAt,
    });

    if (records.length === 0) {
      return { key, recordCount: 0, bytesWritten: 0, skipped: true };
    }

    const body = serializeRecordsToJsonlGzip(dataset, records);
    const fullPath = join(this.baseDir, key);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, body);

    return {
      key,
      recordCount: records.length,
      bytesWritten: body.byteLength,
    };
  }
}

export interface S3TrainingVaultClientLike {
  send(command: PutObjectCommand): Promise<unknown>;
}

export interface S3TrainingVaultConfig {
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  client?: S3TrainingVaultClientLike;
}

export class S3TrainingVaultSink implements TrainingVaultSink {
  readonly kind = "s3" as const;
  private readonly bucket: string;
  private readonly client: S3TrainingVaultClientLike;

  constructor(config: S3TrainingVaultConfig) {
    this.bucket = config.bucket;
    this.client =
      config.client ??
      new S3Client({
        region: config.region ?? "eu-central-1",
        endpoint: config.endpoint,
        forcePathStyle: config.forcePathStyle ?? true,
        ...(config.accessKeyId && config.secretAccessKey
          ? {
              credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
              },
            }
          : {}),
      });
  }

  async writeBatch<D extends TrainingVaultDataset>(
    dataset: D,
    records: readonly TrainingVaultRecordMap[D][],
    options?: TrainingVaultWriteOptions,
  ): Promise<TrainingVaultWriteResult> {
    const plane = TRAINING_VAULT_DATASET_PLANE[dataset];
    const key = buildTrainingVaultKey({
      plane,
      dataset,
      batchId: options?.batchId ?? generateBatchId(dataset),
      recordedAt: options?.recordedAt,
    });

    if (records.length === 0) {
      return { key, recordCount: 0, bytesWritten: 0, skipped: true };
    }

    const body = serializeRecordsToJsonlGzip(dataset, records);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: "application/x-ndjson",
        ContentEncoding: "gzip",
      }),
    );

    return {
      key,
      recordCount: records.length,
      bytesWritten: body.byteLength,
    };
  }
}

export interface TrainingVaultEnvConfig {
  TRAINING_VAULT_DIR?: string;
  TRAINING_VAULT_S3_BUCKET?: string;
  TRAINING_VAULT_S3_ENDPOINT?: string;
  TRAINING_VAULT_S3_REGION?: string;
  TRAINING_VAULT_S3_ACCESS_KEY_ID?: string;
  TRAINING_VAULT_S3_SECRET_ACCESS_KEY?: string;
  TRAINING_VAULT_S3_FORCE_PATH_STYLE?: boolean;
}

export function createTrainingVaultSinkFromConfig(
  config: TrainingVaultEnvConfig,
): TrainingVaultSink {
  if (config.TRAINING_VAULT_S3_BUCKET) {
    return new S3TrainingVaultSink({
      bucket: config.TRAINING_VAULT_S3_BUCKET,
      endpoint: config.TRAINING_VAULT_S3_ENDPOINT,
      region: config.TRAINING_VAULT_S3_REGION ?? "eu-central-1",
      accessKeyId: config.TRAINING_VAULT_S3_ACCESS_KEY_ID,
      secretAccessKey: config.TRAINING_VAULT_S3_SECRET_ACCESS_KEY,
      forcePathStyle: config.TRAINING_VAULT_S3_FORCE_PATH_STYLE ?? true,
    });
  }
  if (config.TRAINING_VAULT_DIR) {
    return new LocalFsTrainingVaultSink(config.TRAINING_VAULT_DIR);
  }
  return new NoopTrainingVaultSink();
}

/**
 * Best-effort, non-blocking vault write helper. Logs structured warnings on
 * failure and never throws, so storage outages never fail sweeps or API calls.
 */
export async function safeWriteVaultBatch<D extends TrainingVaultDataset>(
  sink: TrainingVaultSink | undefined,
  dataset: D,
  records: readonly TrainingVaultRecordMap[D][],
  options?: TrainingVaultWriteOptions,
  onError?: (err: unknown, dataset: D) => void,
): Promise<TrainingVaultWriteResult | null> {
  if (!sink || records.length === 0) {
    return null;
  }
  try {
    return await sink.writeBatch(dataset, records, options);
  } catch (err) {
    if (onError) {
      onError(err, dataset);
    } else {
      console.warn(
        `[kulgo-training-vault] Failed to archive ${dataset} (${records.length} records):`,
        err instanceof Error ? err.message : String(err),
      );
    }
    return null;
  }
}
