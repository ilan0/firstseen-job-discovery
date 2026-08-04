import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(value: string) {
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== 32) throw new Error("Capability encryption key must contain 32 bytes.");
  return decoded;
}

export function encryptCapability(value: unknown, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptCapability<T>(value: string, secret: string): T {
  const [version, ivValue, tagValue, ciphertextValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue)
    throw new Error("Encrypted capability has an unsupported format.");
  const decipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const cleartext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(cleartext.toString("utf8")) as T;
}
