import { lookup as dnsLookupPromise } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export const DEFAULT_WEBHOOK_TIMEOUT_MS = 5_000;
export const MAX_WEBHOOK_URL_LENGTH = 2_048;

export interface ResolvedIpAddress {
  address: string;
  family: 4 | 6;
}

export type WebhookDnsLookup = (
  hostname: string,
) => Promise<readonly ResolvedIpAddress[]>;

export interface ValidatedWebhookTarget {
  url: URL;
  addresses: readonly ResolvedIpAddress[];
}

export class WebhookSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookSecurityError";
  }
}

const BLOCKED_EXACT_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata.goog",
]);

const BLOCKED_HOSTNAME_SUFFIXES = [
  ".localhost",
  ".localdomain",
  ".local",
  ".internal",
  ".home.arpa",
];

// Non-public / special-purpose IPv4 CIDR blocks (IANA Special-Purpose Registry)
const BLOCKED_IPV4_CIDRS: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 0xff000000], // 0.0.0.0/8       ("This" network / unspecified)
  [0x0a000000, 0xff000000], // 10.0.0.0/8      (RFC 1918 private)
  [0x64400000, 0xffc00000], // 100.64.0.0/10   (RFC 6598 shared / CGNAT)
  [0x7f000000, 0xff000000], // 127.0.0.0/8     (Loopback)
  [0xa9fe0000, 0xffff0000], // 169.254.0.0/16  (Link-local / cloud metadata)
  [0xac100000, 0xfff00000], // 172.16.0.0/12   (RFC 1918 private)
  [0xc0000000, 0xffffff00], // 192.0.0.0/24    (IETF protocol assignments)
  [0xc0000200, 0xffffff00], // 192.0.2.0/24    (TEST-NET-1 documentation)
  [0xc0586300, 0xffffff00], // 192.88.99.0/24  (6to4 relay anycast)
  [0xc0a80000, 0xffff0000], // 192.168.0.0/16  (RFC 1918 private)
  [0xc6120000, 0xfffe0000], // 198.18.0.0/15   (Benchmarking)
  [0xc6336400, 0xffffff00], // 198.51.100.0/24 (TEST-NET-2 documentation)
  [0xcb007100, 0xffffff00], // 203.0.113.0/24  (TEST-NET-3 documentation)
  [0xe0000000, 0xf0000000], // 224.0.0.0/4     (Multicast)
  [0xf0000000, 0xf0000000], // 240.0.0.0/4     (Reserved + 255.255.255.255 broadcast)
];

function parseIpv4ToUint32(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    value = ((value << 8) | octet) >>> 0;
  }
  return value;
}

function isPublicIpv4Uint32(value: number): boolean {
  for (const [network, mask] of BLOCKED_IPV4_CIDRS) {
    if (((value & mask) >>> 0) === network) {
      return false;
    }
  }
  return true;
}

export function isPublicIpv4(ip: string): boolean {
  const value = parseIpv4ToUint32(ip);
  if (value === null) return false;
  return isPublicIpv4Uint32(value);
}

function parseIpv6ToBigInt(ip: string): bigint | null {
  if (!ip || ip.includes("%") || !net.isIPv6(ip)) {
    return null;
  }

  // Normalize optional embedded IPv4 suffix (e.g. ::ffff:127.0.0.1) into 2 hex groups
  let normalized = ip.toLowerCase();
  const lastColon = normalized.lastIndexOf(":");
  if (lastColon !== -1 && normalized.slice(lastColon + 1).includes(".")) {
    const v4Part = normalized.slice(lastColon + 1);
    const v4 = parseIpv4ToUint32(v4Part);
    if (v4 === null) return null;
    const hi = ((v4 >>> 16) & 0xffff).toString(16);
    const lo = (v4 & 0xffff).toString(16);
    normalized = `${normalized.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const doubleColonParts = normalized.split("::");
  if (doubleColonParts.length > 2) return null;

  const left = doubleColonParts[0] ? doubleColonParts[0].split(":") : [];
  const right =
    doubleColonParts.length === 2 && doubleColonParts[1]
      ? doubleColonParts[1].split(":")
      : [];

  let groups: string[];
  if (doubleColonParts.length === 2) {
    const missing = 8 - (left.length + right.length);
    if (missing < 1) return null;
    groups = [...left, ...Array<string>(missing).fill("0"), ...right];
  } else {
    if (left.length !== 8) return null;
    groups = left;
  }

  let result = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    result = (result << 16n) | BigInt(parseInt(group, 16));
  }
  return result;
}

function inIpv6Cidr(addr: bigint, prefix: bigint, prefixLen: number): boolean {
  const shift = BigInt(128 - prefixLen);
  return addr >> shift === prefix >> shift;
}

const IPV6_GLOBAL_UNICAST_PREFIX = parseIpv6ToBigInt("2000::")!;
const BLOCKED_GLOBAL_IPV6_CIDRS: ReadonlyArray<readonly [bigint, number]> = [
  [parseIpv6ToBigInt("2001::")!, 23], // IETF protocol assignments (Teredo, Benchmarking, ORCHID)
  [parseIpv6ToBigInt("2001:db8::")!, 32], // Documentation (RFC 3849)
  [parseIpv6ToBigInt("2002::")!, 16], // 6to4 (embeds IPv4, RFC 3056)
  [parseIpv6ToBigInt("3fff::")!, 20], // Documentation (RFC 9637)
];

export function isPublicIpv6(ip: string): boolean {
  const addr = parseIpv6ToBigInt(ip);
  if (addr === null) return false;

  // IPv4-mapped IPv6 (::ffff:0:0/96): evaluate embedded IPv4 address
  if (addr >> 32n === 0xffffn) {
    const embeddedV4 = Number(addr & 0xffffffffn);
    return isPublicIpv4Uint32(embeddedV4);
  }

  // Only IANA Global Unicast (2000::/3) is routable public IPv6.
  // This automatically rejects ::, ::1, ::/96, 64:ff9b::/96, 100::/64,
  // fc00::/7 (ULA), fe80::/10 (link-local), fec0::/10, ff00::/8 (multicast), etc.
  if (!inIpv6Cidr(addr, IPV6_GLOBAL_UNICAST_PREFIX, 3)) {
    return false;
  }

  for (const [prefix, prefixLen] of BLOCKED_GLOBAL_IPV6_CIDRS) {
    if (inIpv6Cidr(addr, prefix, prefixLen)) {
      return false;
    }
  }

  return true;
}

export function isPublicIp(ip: string): boolean {
  const bare = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;
  const family = net.isIP(bare);
  if (family === 4) return isPublicIpv4(bare);
  if (family === 6) return isPublicIpv6(bare);
  return false;
}

export const defaultWebhookDnsLookup: WebhookDnsLookup = async (hostname) => {
  const results = await dnsLookupPromise(hostname, { all: true, verbatim: true });
  return results
    .filter((entry) => entry.family === 4 || entry.family === 6)
    .map((entry) => ({
      address: entry.address,
      family: entry.family as 4 | 6,
    }));
};

function raceWithSignal<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(
      new WebhookSecurityError("Webhook DNS resolution timed out"),
    );
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new WebhookSecurityError("Webhook DNS resolution timed out"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

/**
 * Validates that a webhook URL uses HTTP(S), has no embedded credentials or
 * local/internal hostnames, and resolves exclusively to public IPv4/IPv6 addresses.
 */
export async function validateWebhookDestination(
  rawUrl: string,
  options: {
    dnsLookup?: WebhookDnsLookup;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<ValidatedWebhookTarget> {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > MAX_WEBHOOK_URL_LENGTH) {
    throw new WebhookSecurityError(
      `Webhook URL must be between 1 and ${MAX_WEBHOOK_URL_LENGTH} characters`,
    );
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new WebhookSecurityError("Webhook URL is not a valid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebhookSecurityError(
      "Webhook URL must use http:// or https:// protocol",
    );
  }

  if (url.username || url.password) {
    throw new WebhookSecurityError(
      "Webhook URL must not contain embedded credentials",
    );
  }

  const rawHost =
    url.hostname.startsWith("[") && url.hostname.endsWith("]")
      ? url.hostname.slice(1, -1)
      : url.hostname;

  if (!rawHost || rawHost.includes("%")) {
    throw new WebhookSecurityError("Webhook URL hostname is invalid");
  }

  const normalizedHost = rawHost.toLowerCase().replace(/\.$/, "");
  if (!normalizedHost) {
    throw new WebhookSecurityError("Webhook URL hostname is invalid");
  }

  const literalFamily = net.isIP(normalizedHost);
  if (literalFamily === 4) {
    if (!isPublicIpv4(normalizedHost)) {
      throw new WebhookSecurityError(
        "Webhook destination IP address is not a public IPv4 address",
      );
    }
    return {
      url,
      addresses: [{ address: normalizedHost, family: 4 }],
    };
  }
  if (literalFamily === 6) {
    if (!isPublicIpv6(normalizedHost)) {
      throw new WebhookSecurityError(
        "Webhook destination IP address is not a public IPv6 address",
      );
    }
    return {
      url,
      addresses: [{ address: normalizedHost, family: 6 }],
    };
  }

  if (
    BLOCKED_EXACT_HOSTNAMES.has(normalizedHost) ||
    BLOCKED_HOSTNAME_SUFFIXES.some((suffix) =>
      normalizedHost.endsWith(suffix),
    ) ||
    !normalizedHost.includes(".")
  ) {
    throw new WebhookSecurityError(
      "Webhook destination hostname is not a public domain",
    );
  }

  const dnsLookup = options.dnsLookup ?? defaultWebhookDnsLookup;
  let localController: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lookupSignal = options.signal;

  if (!lookupSignal || options.timeoutMs !== undefined) {
    const deadlineMs = options.timeoutMs ?? DEFAULT_WEBHOOK_TIMEOUT_MS;
    localController = new AbortController();
    timer = setTimeout(() => {
      localController?.abort(
        new WebhookSecurityError("Webhook DNS resolution timed out"),
      );
    }, deadlineMs);
    lookupSignal = lookupSignal
      ? AbortSignal.any([lookupSignal, localController.signal])
      : localController.signal;
  }

  let resolved: readonly ResolvedIpAddress[];
  try {
    resolved = await raceWithSignal(dnsLookup(normalizedHost), lookupSignal);
  } catch (err) {
    if (err instanceof WebhookSecurityError) {
      throw err;
    }
    throw new WebhookSecurityError("Webhook hostname could not be resolved");
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }

  if (resolved.length === 0) {
    throw new WebhookSecurityError("Webhook hostname resolved to no addresses");
  }

  const validatedAddresses: ResolvedIpAddress[] = [];
  for (const entry of resolved) {
    if (!isPublicIp(entry.address)) {
      throw new WebhookSecurityError(
        "Webhook hostname resolved to a non-public IP address",
      );
    }
    const family = net.isIP(entry.address);
    if (family !== 4 && family !== 6) {
      throw new WebhookSecurityError(
        "Webhook hostname resolved to an invalid IP address",
      );
    }
    validatedAddresses.push({
      address: entry.address,
      family: family as 4 | 6,
    });
  }

  return {
    url,
    addresses: validatedAddresses,
  };
}

/**
 * Creates a Node.js `net.LookupFunction` pinned to pre-validated IP addresses
 * so the TCP socket connects only to the validated public IPs without issuing
 * a second DNS lookup (eliminating DNS-rebinding TOCTOU).
 */
export function createPinnedLookup(
  addresses: readonly ResolvedIpAddress[],
): net.LookupFunction {
  return (_hostname, options, callback) => {
    if (addresses.length === 0) {
      callback(new WebhookSecurityError("No validated webhook IP addresses"), "", 4);
      return;
    }
    const opts = typeof options === "number" ? { family: options } : options;
    const requestedFamily = opts?.family;
    const filtered =
      requestedFamily === 4 || requestedFamily === 6
        ? addresses.filter((a) => a.family === requestedFamily)
        : addresses;
    const candidates = filtered.length > 0 ? filtered : addresses;

    if (opts?.all) {
      const lookupList = candidates.map((a) => ({
        address: a.address,
        family: a.family,
      }));
      (
        callback as (
          err: NodeJS.ErrnoException | null,
          addresses: Array<{ address: string; family: number }>,
        ) => void
      )(null, lookupList);
      return;
    }

    const first = candidates[0]!;
    callback(null, first.address, first.family);
  };
}

export interface DeliverSafeWebhookOptions {
  url: string;
  headers: Record<string, string>;
  body: string;
  fetchFn?: typeof fetch;
  dnsLookup?: WebhookDnsLookup;
  timeoutMs?: number;
}

/**
 * Delivers an outbound alert webhook with SSRF protection:
 * - Re-validates URL syntax and DNS resolution on every attempt (defends against DNS changes)
 * - Prevents redirects (`redirect: "manual"` + explicit 3xx rejection)
 * - Pins TCP connections to the validated public IP(s) on the default transport (prevents DNS rebinding)
 * - Bounds total request duration with an abort timeout and discards/cancels response bodies
 */
export async function deliverSafeWebhook(
  options: DeliverSafeWebhookOptions,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_WEBHOOK_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(
      new WebhookSecurityError(`Webhook request timed out after ${timeoutMs}ms`),
    );
  }, timeoutMs);

  try {
    const validated = await validateWebhookDestination(options.url, {
      dnsLookup: options.dnsLookup,
      signal: controller.signal,
    });

    if (options.fetchFn) {
      let res: Response;
      try {
        res = await options.fetchFn(validated.url.toString(), {
          method: "POST",
          headers: options.headers,
          body: options.body,
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (err) {
        if (timedOut) {
          throw new WebhookSecurityError(
            `Webhook request timed out after ${timeoutMs}ms`,
          );
        }
        throw err;
      }

      try {
        if (
          res.type === "opaqueredirect" ||
          (res.status >= 300 && res.status < 400)
        ) {
          throw new WebhookSecurityError(
            `Webhook redirect blocked (HTTP ${res.status || 302})`,
          );
        }
        if (!res.ok) {
          throw new Error(`Webhook HTTP ${res.status}`);
        }
      } finally {
        // Bound response handling: discard body stream immediately without buffering
        await res.body?.cancel().catch(() => {});
      }
      return;
    }

    await sendPinnedHttpRequest(validated, options.headers, options.body, {
      signal: controller.signal,
      timeoutMs,
      isTimedOut: () => timedOut,
    });
  } finally {
    clearTimeout(timer);
  }
}

function sendPinnedHttpRequest(
  target: ValidatedWebhookTarget,
  headers: Record<string, string>,
  body: string,
  control: {
    signal: AbortSignal;
    timeoutMs: number;
    isTimedOut: () => boolean;
  },
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const transport = target.url.protocol === "https:" ? https : http;
    const bodyBytes = Buffer.byteLength(body, "utf8");
    const req = transport.request(
      target.url,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": String(bodyBytes),
        },
        agent: false,
        lookup: createPinnedLookup(target.addresses),
        signal: control.signal,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        // Immediately destroy the response stream to avoid buffering unbounded bodies
        res.on("error", () => {});
        res.destroy();

        if (status >= 300 && status < 400) {
          reject(
            new WebhookSecurityError(`Webhook redirect blocked (HTTP ${status})`),
          );
          return;
        }
        if (status < 200 || status >= 300) {
          reject(new Error(`Webhook HTTP ${status}`));
          return;
        }
        resolve();
      },
    );

    req.on("error", (err) => {
      if (control.isTimedOut()) {
        reject(
          new WebhookSecurityError(
            `Webhook request timed out after ${control.timeoutMs}ms`,
          ),
        );
        return;
      }
      reject(err);
    });

    req.end(body);
  });
}
