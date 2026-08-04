import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
const VERSION = "v1";
const KEY_LENGTH = 32;
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const MAX_MEMORY = 32 * 1024 * 1024;

export const accessCodePattern = /^\d{4}$/;

async function derive(code: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(
      code,
      salt,
      KEY_LENGTH,
      { N: COST, r: BLOCK_SIZE, p: PARALLELIZATION, maxmem: MAX_MEMORY },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

export async function hashAccessCode(
  code: string,
  salt: Buffer = randomBytes(16),
): Promise<string> {
  if (!accessCodePattern.test(code))
    throw new Error("Access code must contain exactly four digits");
  const digest = await derive(code, salt);
  return [
    VERSION,
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString("base64url"),
    digest.toString("base64url"),
  ].join(".");
}

export async function verifyAccessCode(code: string, encodedHash: string): Promise<boolean> {
  if (!accessCodePattern.test(code)) return false;
  const [version, cost, blockSize, parallelization, encodedSalt, encodedDigest, extra] =
    encodedHash.split(".");
  if (
    extra !== undefined ||
    version !== VERSION ||
    Number(cost) !== COST ||
    Number(blockSize) !== BLOCK_SIZE ||
    Number(parallelization) !== PARALLELIZATION ||
    !encodedSalt ||
    !encodedDigest
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(encodedSalt, "base64url");
    const expected = Buffer.from(encodedDigest, "base64url");
    if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
    const actual = await derive(code, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
