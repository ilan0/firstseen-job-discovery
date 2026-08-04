import { randomBytes } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import webPush from "web-push";

const secretsPath = process.argv[2];
if (!secretsPath) throw new Error("Pass the external secrets file path as the first argument.");

function values(content: string) {
  return new Map(
    content
      .split(/\r?\n/)
      .filter((line) => line && !line.trimStart().startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)] as const;
      }),
  );
}

function upsert(content: string, key: string, value: string) {
  const expression = new RegExp(`^${key}=.*$`, "m");
  return expression.test(content)
    ? content.replace(expression, `${key}=${value}`)
    : `${content.replace(/\s*$/, "\n")}${key}=${value}\n`;
}

let external = readFileSync(secretsPath, "utf8");
const existing = values(external);
let local = readFileSync(".env.local", "utf8");
const localExisting = values(local);
let publicKey = existing.get("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
let privateKey = existing.get("VAPID_PRIVATE_KEY");
if (!publicKey || !privateKey) {
  const generated = webPush.generateVAPIDKeys();
  publicKey = generated.publicKey;
  privateKey = generated.privateKey;
}
const ownerEmail = existing.get("OWNER_EMAIL") || localExisting.get("OWNER_EMAIL");
if (!ownerEmail) throw new Error("OWNER_EMAIL must exist in an ignored environment file.");
const subject = existing.get("VAPID_SUBJECT") || `mailto:${ownerEmail}`;
const encryptionKey =
  existing.get("PUSH_SUBSCRIPTION_ENCRYPTION_KEY") || randomBytes(32).toString("base64url");
const generatedValues = {
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: publicKey,
  VAPID_PRIVATE_KEY: privateKey,
  VAPID_SUBJECT: subject,
  PUSH_SUBSCRIPTION_ENCRYPTION_KEY: encryptionKey,
};
for (const [key, value] of Object.entries(generatedValues)) external = upsert(external, key, value);
writeFileSync(secretsPath, external, { mode: 0o600 });
chmodSync(secretsPath, 0o600);

for (const [key, value] of Object.entries(generatedValues)) local = upsert(local, key, value);
writeFileSync(".env.local", local, { mode: 0o600 });
chmodSync(".env.local", 0o600);

process.stdout.write(`${Object.keys(generatedValues).join("\n")}\n`);
