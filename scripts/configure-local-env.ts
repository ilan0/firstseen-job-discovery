import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { hashAccessCode } from "../src/lib/auth/access-code";

type LocalStatus = {
  API_URL: string;
  DB_URL: string;
  PUBLISHABLE_KEY: string;
  SECRET_KEY: string;
};

const secretsPath =
  process.argv[2] ?? "/Users/ilannabatkhorian/Documents/Codex/personal-api-secrets.env";

function parseEnv(contents: string): Record<string, string> {
  return Object.fromEntries(
    contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        if (separator < 1) return [line, ""];
        const key = line.slice(0, separator).trim();
        const raw = line.slice(separator + 1).trim();
        const value =
          (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
            ? raw.slice(1, -1)
            : raw;
        return [key, value];
      }),
  );
}

function requireValue(values: Record<string, string>, key: string): string {
  const value = values[key];
  if (!value) throw new Error(`Missing required configuration: ${key}`);
  return value;
}

const providerValues = parseEnv(readFileSync(resolve(secretsPath), "utf8"));
const target = resolve(".env.local");
const existingValues = (() => {
  try {
    return parseEnv(readFileSync(target, "utf8"));
  } catch {
    return {};
  }
})();
const localAccessCode = execFileSync(
  "security",
  ["find-generic-password", "-a", "ilannabatkhorian", "-s", "firstseen-local-access-code", "-w"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
).trim();
const status = JSON.parse(
  execFileSync(resolve("node_modules/.bin/supabase"), ["status", "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
) as LocalStatus;

const copiedProviderKeys = [
  "ADZUNA_APP_ID",
  "ADZUNA_APP_KEY",
  "BRAVE_SEARCH_API_KEY",
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
  "OPENAI_API_KEY",
  "SENTRY_AUTH_TOKEN",
  "SLACK_WEBHOOK_URL",
] as const;

const output: Record<string, string> = {
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
  // Never let local browser tests enqueue events into the production Inngest app.
  INNGEST_DEV: "1",
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY: status.SECRET_KEY,
  DATABASE_URL: status.DB_URL,
  OWNER_EMAIL: "inabatkhorian@gmail.com",
  ACCESS_CODE_HASH: await hashAccessCode(localAccessCode),
  RATE_LIMIT_SALT: randomBytes(32).toString("base64url"),
  OPENAI_MODEL: "gpt-5.6-luna",
  OPENAI_ESCALATION_MODEL: "gpt-5.6-terra",
  OPENAI_MONTHLY_BUDGET_USD: "25",
  INNGEST_MONTHLY_EXECUTION_LIMIT: "50000",
  GLOBAL_SUPPLY_V2_ENABLED: "false",
  RELATIONSHIP_CRM_ENABLED: "true",
  APPLICATION_WORKFLOW_ENABLED: "true",
  PWA_ENABLED: "true",
  WEB_PUSH_ENABLED: "true",
  PUSH_POLICY_V2_ENABLED: "false",
  INDIVIDUAL_AUTH_ENABLED: "false",
  OWNER_CODE_AUTH_ENABLED: "true",
};

for (const key of copiedProviderKeys) output[key] = requireValue(providerValues, key);
for (const key of [
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
  "PUSH_SUBSCRIPTION_ENCRYPTION_KEY",
] as const) {
  if (existingValues[key]) output[key] = existingValues[key];
}

const body = `${Object.entries(output)
  .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
  .join("\n")}\n`;
writeFileSync(target, body, { encoding: "utf8", mode: 0o600 });
chmodSync(target, 0o600);

console.log(`Configured ${Object.keys(output).length} local environment variables in .env.local.`);
