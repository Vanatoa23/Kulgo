import { promises as fs } from "node:fs";
import path from "node:path";

import { normalizeEntityName } from "@kulgo/shared";

/**
 * Local snapshot of the Estonian e-Business Register (Äriregister) basic-data
 * CSV (`ettevotja_rekvisiidid__lihtandmed.csv`, CC BY 4.0).
 *
 * Only three columns are ever parsed: company name (`nimi`), registry code
 * (`ariregistri_kood`) and status (`ettevotja_staatus`). Personal/contact
 * fields (address, VAT number, links, ...) are ignored by construction.
 *
 * The snapshot file is untracked operator data. It is re-read whenever the
 * file changes on disk (mtime/size), so operators refresh by atomically
 * replacing the file (download zip -> unzip -> rename over the old CSV);
 * no restart is needed. A missing or corrupt file never throws out of the
 * store: searches report the snapshot as unavailable instead.
 */

export type RegistryCompanyStatus = "ACTIVE" | "INACTIVE";

export interface RegistryCompanyEntry {
  legalName: string;
  registryId: string;
  status: RegistryCompanyStatus;
}

export interface RegistrySnapshotIndex {
  byNormalizedName: Map<string, RegistryCompanyEntry[]>;
  byRegistryId: Map<string, RegistryCompanyEntry>;
  loadedAt: string;
  rowCount: number;
}

export type SnapshotState =
  | { kind: "ok"; index: RegistrySnapshotIndex }
  | { kind: "unavailable"; reason: "missing" | "corrupt" };

/** Official status codes: "R" = registered (active); L/N/... = inactive. */
export function mapRegistryStatusCode(code: string): RegistryCompanyStatus {
  return code.trim().toUpperCase() === "R" ? "ACTIVE" : "INACTIVE";
}

function normalizeRegistryId(value: string): string {
  return value.replace(/\s+/g, "");
}

const NAME_HEADERS = new Set([
  "nimi",
  "arinimi",
  "ettevotja nimi",
  "name",
  "legal name",
]);
const CODE_HEADERS = new Set([
  "ariregistri kood",
  "registrikood",
  "registry code",
  "registry id",
]);
const STATUS_HEADERS = new Set([
  "ettevotja staatus",
  "staatus",
  "status",
]);

/**
 * Minimal RFC-4180-style CSV splitter for one line: semicolon-separated,
 * double-quoted fields with "" escapes. The official file is unquoted, but
 * quoted fields are accepted so a re-exported snapshot still parses.
 */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] ?? "";
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ";") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

export class RegistrySnapshotError extends Error {}

/**
 * Parse the official basic-data CSV text into a snapshot index. Throws
 * RegistrySnapshotError when the header does not contain the required
 * name/code columns or when no usable data row exists.
 */
export function parseRegistryCsv(text: string): RegistrySnapshotIndex {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = withoutBom.split(/\r\n|\r|\n/);
  let headerIndex = -1;
  let header: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const headerLine = lines[i] ?? "";
    if (headerLine.trim().length === 0) continue;
    headerIndex = i;
    header = splitCsvLine(headerLine).map((cell) => normalizeEntityName(cell));
    break;
  }
  if (headerIndex < 0) {
    throw new RegistrySnapshotError("Snapshot is empty");
  }
  const nameCol = header.findIndex((cell) => NAME_HEADERS.has(cell));
  const codeCol = header.findIndex((cell) => CODE_HEADERS.has(cell));
  const statusCol = header.findIndex((cell) => STATUS_HEADERS.has(cell));
  if (nameCol < 0 || codeCol < 0) {
    throw new RegistrySnapshotError(
      "Snapshot header is missing the required name/registry-code columns",
    );
  }

  const byNormalizedName = new Map<string, RegistryCompanyEntry[]>();
  const byRegistryId = new Map<string, RegistryCompanyEntry>();
  let rowCount = 0;
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim().length === 0) continue;
    const fields = splitCsvLine(line);
    const legalName = (fields[nameCol] ?? "").trim();
    const registryId = normalizeRegistryId((fields[codeCol] ?? "").trim());
    if (!legalName || !registryId) continue;
    const status = mapRegistryStatusCode(statusCol >= 0 ? fields[statusCol] ?? "" : "");
    const entry: RegistryCompanyEntry = { legalName, registryId, status };
    rowCount += 1;
    const normalized = normalizeEntityName(legalName);
    if (normalized) {
      const bucket = byNormalizedName.get(normalized);
      if (bucket) bucket.push(entry);
      else byNormalizedName.set(normalized, [entry]);
    }
    if (!byRegistryId.has(registryId)) {
      byRegistryId.set(registryId, entry);
    }
  }
  if (rowCount === 0) {
    throw new RegistrySnapshotError("Snapshot contains no usable data rows");
  }
  return {
    byNormalizedName,
    byRegistryId,
    loadedAt: new Date().toISOString(),
    rowCount,
  };
}

/**
 * File-backed snapshot store with safe on-disk refresh: the file is stat-ed
 * on every lookup and re-parsed only when its mtime/size changed, then the
 * in-memory index is swapped atomically. Missing or corrupt files yield
 * `{ kind: "unavailable" }` — they never disable the rest of the app.
 */
export class FileRegistrySnapshotStore {
  private readonly filePath: string;
  private stamp: { mtimeMs: number; size: number } | null = null;
  private index: RegistrySnapshotIndex | null = null;

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
  }

  get path(): string {
    return this.filePath;
  }

  async getSnapshot(): Promise<SnapshotState> {
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(this.filePath);
    } catch {
      this.stamp = null;
      this.index = null;
      return { kind: "unavailable", reason: "missing" };
    }
    if (!stat.isFile()) {
      this.stamp = null;
      this.index = null;
      return { kind: "unavailable", reason: "missing" };
    }
    const mtimeMs = stat.mtimeMs;
    const size = stat.size;
    if (this.index && this.stamp && this.stamp.mtimeMs === mtimeMs && this.stamp.size === size) {
      return { kind: "ok", index: this.index };
    }
    let text: string;
    try {
      text = await fs.readFile(this.filePath, "utf8");
    } catch {
      return { kind: "unavailable", reason: "corrupt" };
    }
    let index: RegistrySnapshotIndex;
    try {
      index = parseRegistryCsv(text);
    } catch {
      return { kind: "unavailable", reason: "corrupt" };
    }
    this.stamp = { mtimeMs, size };
    this.index = index;
    return { kind: "ok", index };
  }
}
