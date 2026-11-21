import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

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
    argon2(
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
 * Hashes a plaintext password using Node 24 native Argon2id and returns a PHC-formatted string:
 * `$argon2id$v=19$m=<memory>,t=<passes>,p=<parallelism>$<salt_b64>$<hash_b64>`
 */
export async function hashPassword(
  password: string,
  params: Argon2Params = DEFAULT_ARGON2_PARAMS,
): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await deriveArgon2id(password, salt, params);
  return `$argon2id$v=${ARGON2_VERSION}$m=${params.memory},t=${params.passes},p=${params.parallelism}$${encodeBase64NoPad(salt)}$${encodeBase64NoPad(derived)}`;
}

/**
 * Verifies a plaintext password against a PHC-formatted Argon2id hash using constant-time comparison.
 */
export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const parts = encodedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "" || parts[1] !== "argon2id") {
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
}
