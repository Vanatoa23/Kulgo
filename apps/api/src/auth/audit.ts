import {
  AuditMetadataValueSchema,
  type AuditAction,
  type AuditMetadataValue,
} from "@kulgo/shared";

export interface RecordAuditEventInput {
  orgId: string;
  actorUserId: string;
  actorEmail: string;
  action: AuditAction;
  summary: string;
  metadata?: Record<string, unknown>;
}

/**
 * Keys that must NEVER be persisted in compliance audit metadata:
 * - Credentials & auth/invite secrets (passwords, hashes, tokens, cookies)
 * - Hidden Tier-2+ partner identities, upstream graph internals, or exact coordinates
 */
const FORBIDDEN_AUDIT_METADATA_KEY_PATTERN =
  /(password|passphrase|secret|token|cookie|session|authorization|credential|hash|lat|lng|latitude|longitude|coord|wkt|polygon|tier2|tier3|upstream|partnerorg|partnerfacility|hidden)/i;

const MAX_AUDIT_METADATA_KEYS = 24;
const MAX_AUDIT_STRING_LENGTH = 240;

/**
 * Strips any sensitive, secret, coordinate, or hidden Tier-2+ keys from audit
 * metadata and keeps only bounded scalar primitives (string | number | boolean | null).
 */
export function sanitizeAuditMetadata(
  raw?: Record<string, unknown>,
): Record<string, AuditMetadataValue> {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const sanitized: Record<string, AuditMetadataValue> = {};
  let count = 0;

  for (const [rawKey, rawValue] of Object.entries(raw)) {
    if (count >= MAX_AUDIT_METADATA_KEYS) {
      break;
    }
    const key = rawKey.trim();
    if (key.length === 0 || key.length > 64) {
      continue;
    }
    if (FORBIDDEN_AUDIT_METADATA_KEY_PATTERN.test(key)) {
      continue;
    }
    if (rawValue === undefined) {
      continue;
    }

    let candidate: unknown = rawValue;
    if (typeof candidate === "string") {
      candidate = candidate.trim().slice(0, MAX_AUDIT_STRING_LENGTH);
    }

    const parsed = AuditMetadataValueSchema.safeParse(candidate);
    if (!parsed.success) {
      // Drop nested objects, arrays, NaN, Infinity, etc.
      continue;
    }

    sanitized[key] = parsed.data;
    count += 1;
  }

  return sanitized;
}
