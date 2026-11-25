import * as nodeCrypto from "node:crypto";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

type Argon2Fn = (
  algorithm: "argon2id",
  parameters: {
    message: string;
    nonce: Buffer;
    memory: number;
    passes: number;
    parallelism: number;
    tagLength: number;
  },
  callback: (err: Error | null, derivedKey: Buffer) => void,
) => void;

const argon2Fn: Argon2Fn | undefined =
  typeof (nodeCrypto as Record<string, unknown>).argon2 === "function"
    ? ((nodeCrypto as unknown as { argon2: Argon2Fn }).argon2)
    : undefined;

export interface Argon2Params {
  memory: number;
  passes: number;
  parallelism: number;
  tagLength: number;
}

/**
 * OWASP-recommended Argon2id defaults (19 MiB memory, 2 iterations, 1 lane, 32-byte tag).
 */
export const DEFAULT_ARGON2_PARAMS: Readonly<Argon2Params> = {
  memory: 19456,
  passes: 2,
  parallelism: 1,
  tagLength: 32,
};

const SALT_BYTES = 16;
const ARGON2_VERSION = 19;

function deriveArgon2id(
  password: string,
  nonce: Buffer,
  params: Argon2Params,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!argon2Fn) {
      reject(new Error("argon2 not available"));
      return;
    }
    argon2Fn(
      "argon2id",
      {
        message: password,
        nonce,
        memory: params.memory,
        passes: params.passes,
        parallelism: params.parallelism,
        tagLength: params.tagLength,
      },
      (err, derivedKey) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

function deriveScrypt(
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
  keylen: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, { N: n, r, p }, (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(derivedKey);
    });
  });
}

function encodeBase64NoPad(buf: Buffer): string {
  return buf.toString("base64").replace(/=+$/, "");
}

function decodeBase64NoPad(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+$/.test(value)) {
    return null;
  }
  const padLen = (4 - (value.length % 4)) % 4;
  return Buffer.from(value + "=".repeat(padLen), "base64");
}

/**
 * Hashes a plaintext password using Node 24 native Argon2id (or scrypt fallback on Node 22) and returns a PHC-formatted string:
 * `$argon2id$v=19$m=<memory>,t=<passes>,p=<parallelism>$<salt_b64>$<hash_b64>`
 * or `$scrypt$n=16384,r=8,p=1$<salt_b64>$<hash_b64>`
 */
export async function hashPassword(
  password: string,
  params: Argon2Params = DEFAULT_ARGON2_PARAMS,
): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  if (argon2Fn) {
    const derived = await deriveArgon2id(password, salt, params);
    return `$argon2id$v=${ARGON2_VERSION}$m=${params.memory},t=${params.passes},p=${params.parallelism}$${encodeBase64NoPad(salt)}$${encodeBase64NoPad(derived)}`;
  } else {
    const n = 16384;
    const r = 8;
    const p = 1;
    const keylen = 32;
    const derived = await deriveScrypt(password, salt, n, r, p, keylen);
    return `$scrypt$n=${n},r=${r},p=${p}$${encodeBase64NoPad(salt)}$${encodeBase64NoPad(derived)}`;
  }
}

/**
 * Verifies a plaintext password against a PHC-formatted Argon2id or scrypt hash using constant-time comparison.
 */
export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const parts = encodedHash.split("$");
  if (parts.length < 5 || parts[0] !== "") {
    return false;
  }

  const algorithm = parts[1];
  if (algorithm === "argon2id") {
    if (!argon2Fn) {
      return false;
    }
    const versionPart = parts[2];
    const paramPart = parts[3];
    const saltPart = parts[4];
    const hashPart = parts[5];

    if (!versionPart || !paramPart || !saltPart || !hashPart) {
      return false;
    }

    if (versionPart !== `v=${ARGON2_VERSION}`) {
      return false;
    }

    const paramMatch = /^m=(\d+),t=(\d+),p=(\d+)$/.exec(paramPart);
    if (!paramMatch) {
      return false;
    }

    const memory = Number(paramMatch[1]);
    const passes = Number(paramMatch[2]);
    const parallelism = Number(paramMatch[3]);

    if (
      !Number.isSafeInteger(memory) ||
      !Number.isSafeInteger(passes) ||
      !Number.isSafeInteger(parallelism) ||
      memory < 8 ||
      memory > 65536 ||
      passes < 1 ||
      passes > 10 ||
      parallelism < 1 ||
      parallelism > 4
    ) {
      return false;
    }

    const salt = decodeBase64NoPad(saltPart);
    const expectedTag = decodeBase64NoPad(hashPart);
    if (!salt || !expectedTag || salt.length < 8 || expectedTag.length < 16) {
      return false;
    }

    try {
      const actualTag = await deriveArgon2id(password, salt, {
        memory,
        passes,
        parallelism,
        tagLength: expectedTag.length,
      });
      if (actualTag.length !== expectedTag.length) {
        return false;
      }
      return timingSafeEqual(actualTag, expectedTag);
    } catch {
      return false;
    }
  } else if (algorithm === "scrypt" && parts.length === 5) {
    const paramPart = parts[2];
    const saltPart = parts[3];
    const hashPart = parts[4];

    if (!paramPart || !saltPart || !hashPart) {
      return false;
    }

    const paramMatch = /^n=(\d+),r=(\d+),p=(\d+)$/.exec(paramPart);
    if (!paramMatch) {
      return false;
    }

    const n = Number(paramMatch[1]);
    const r = Number(paramMatch[2]);
    const p = Number(paramMatch[3]);

    const salt = decodeBase64NoPad(saltPart);
    const expectedTag = decodeBase64NoPad(hashPart);
    if (!salt || !expectedTag || salt.length < 8 || expectedTag.length < 16) {
      return false;
    }

    try {
      const actualTag = await deriveScrypt(password, salt, n, r, p, expectedTag.length);
      if (actualTag.length !== expectedTag.length) {
        return false;
      }
      return timingSafeEqual(actualTag, expectedTag);
    } catch {
      return false;
    }
  }

  return false;
}
