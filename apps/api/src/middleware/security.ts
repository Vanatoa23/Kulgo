import type { Context } from "hono";
import { createMiddleware } from "hono/factory";

export interface RateLimiterOptions {
  bucket: string;
  maxRequests: number;
  windowMs: number;
  now?: () => number;
}

interface RateLimitEntry {
  count: number;
  resetAtMs: number;
}

const MAX_TRACKED_KEYS = 10_000;
const PRUNE_THRESHOLD = 1000;

function getClientKey(c: Context): string {
  const realIp = c.req.header("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) {
      return last;
    }
  }
  return "local";
}

/**
 * Lightweight, dependency-free in-memory fixed-window rate limiter.
 * Disabled (pass-through) when maxRequests <= 0.
 */
export function createRateLimiter({
  bucket,
  maxRequests,
  windowMs,
  now = () => Date.now(),
}: RateLimiterOptions) {
  const store = new Map<string, RateLimitEntry>();
  let lastPrune = -Infinity;

  const pruneExpired = (currentMs: number, force = false) => {
    if (
      !force &&
      (store.size < PRUNE_THRESHOLD || currentMs - lastPrune < windowMs)
    ) {
      return;
    }
    lastPrune = currentMs;
    for (const [key, entry] of store.entries()) {
      if (entry.resetAtMs <= currentMs) {
        store.delete(key);
      }
    }
  };

  return createMiddleware(async (c, next) => {
    if (maxRequests <= 0) {
      await next();
      return;
    }

    const currentMs = now();
    pruneExpired(currentMs);

    const key = `${bucket}:${getClientKey(c)}`;
    let entry = store.get(key);
    if (!entry || entry.resetAtMs <= currentMs) {
      if (entry) {
        store.delete(key);
      } else if (store.size >= MAX_TRACKED_KEYS) {
        pruneExpired(currentMs, true);
        if (store.size >= MAX_TRACKED_KEYS) {
          const oldestKey = store.keys().next().value;
          if (oldestKey !== undefined) {
            store.delete(oldestKey);
          }
        }
      }
      entry = { count: 0, resetAtMs: currentMs + windowMs };
      store.set(key, entry);
    }

    entry.count += 1;
    const remaining = Math.max(0, maxRequests - entry.count);
    const resetEpochSeconds = Math.ceil(entry.resetAtMs / 1000);

    c.header("X-RateLimit-Limit", String(maxRequests));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(resetEpochSeconds));

    if (entry.count > maxRequests) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((entry.resetAtMs - currentMs) / 1000),
      );
      c.header("Retry-After", String(retryAfterSeconds));
      return c.json(
        { error: "Too many requests. Please try again later." },
        429,
      );
    }

    await next();
  });
}

export interface BodySizeLimitOptions {
  maxJsonBytes: number;
  maxImportBytes: number;
}

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

/**
 * Enforces request payload byte limits for JSON and CSV/bulk import routes.
 * Checks both Content-Length header and actual streamed byte count in a single
 * pass without cloning/double-buffering the request stream.
 */
export function createBodySizeLimitMiddleware({
  maxJsonBytes,
  maxImportBytes,
}: BodySizeLimitOptions) {
  return createMiddleware(async (c, next) => {
    if (!BODY_METHODS.has(c.req.method.toUpperCase())) {
      await next();
      return;
    }

    const maxBytes =
      c.req.path === "/api/v1/workspace/import" ? maxImportBytes : maxJsonBytes;

    const contentLengthHeader = c.req.header("content-length");
    if (contentLengthHeader !== undefined) {
      const declaredLength = Number(contentLengthHeader);
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        return c.json({ error: "Request payload too large" }, 413);
      }
    }

    if (c.req.raw.body) {
      const reader = c.req.raw.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            await reader.cancel().catch(() => {});
            return c.json({ error: "Request payload too large" }, 413);
          }
          chunks.push(value);
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // Lock already released
        }
      }

      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
      }

      c.req.raw = new Request(c.req.raw.url, {
        method: c.req.raw.method,
        headers: c.req.raw.headers,
        body: combined,
      });
    }

    await next();
  });
}

export interface RequestLogEntry {
  level: "info" | "warn" | "error";
  event: "http_request";
  timestamp: string;
  method: string;
  path: string;
  status: number;
  latencyMs: number;
}

export interface RequestLoggerOptions {
  enabled: boolean;
  onLog?: (entry: RequestLogEntry) => void;
}

/**
 * Redacts sensitive path parameters (such as partner invite tokens) so they
 * never appear in structured request logs.
 */
export function sanitizeLogPath(path: string): string {
  // Strip any accidental query string if present
  const withoutQuery = path.split("?")[0] ?? path;
  // Redact invite token in /api/v1/invites/<token>/accept
  return withoutQuery.replace(
    /^(\/api\/v1\/invites\/)[^/]+(\/accept\/?)$/,
    "$1[REDACTED]$2",
  );
}

/**
 * Structured JSON HTTP request logger.
 * Logs ONLY method, sanitized path, status, and latencyMs —
 * never passwords, session cookies, request bodies, query strings, or invite tokens.
 */
export function createRequestLogger({ enabled, onLog }: RequestLoggerOptions) {
  return createMiddleware(async (c, next) => {
    const startMs = performance.now();
    await next();

    if (!enabled && !onLog) {
      return;
    }

    const status = c.res.status;
    const latencyMs = Math.round((performance.now() - startMs) * 100) / 100;
    const level: RequestLogEntry["level"] =
      status >= 500 ? "error" : status >= 400 ? "warn" : "info";

    const entry: RequestLogEntry = {
      level,
      event: "http_request",
      timestamp: new Date().toISOString(),
      method: c.req.method,
      path: sanitizeLogPath(c.req.path),
      status,
      latencyMs,
    };

    if (onLog) {
      onLog(entry);
    } else if (enabled) {
      console.log(JSON.stringify(entry));
    }
  });
}
