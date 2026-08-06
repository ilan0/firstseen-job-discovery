import "server-only";
import { z } from "zod";

const serverEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  SUPABASE_SECRET_KEY: z.string().min(20),
  DATABASE_URL: z.string().min(20),
  OWNER_EMAIL: z.string().email(),
  ACCESS_CODE_HASH: z.string().startsWith("v1."),
  RATE_LIMIT_SALT: z.string().min(24),
  INNGEST_EVENT_KEY: z.string().min(1),
  INNGEST_SIGNING_KEY: z.string().min(1),
  INNGEST_MONTHLY_EXECUTION_LIMIT: z.coerce.number().int().positive().default(50_000),
  OPENAI_API_KEY: z.string().min(20),
  OPENAI_MODEL: z.string().default("gpt-5.6-luna"),
  OPENAI_ESCALATION_MODEL: z.string().default("gpt-5.6-terra"),
  OPENAI_MONTHLY_BUDGET_USD: z.coerce.number().positive().default(25),
  BRAVE_SEARCH_API_KEY: z.string().min(10),
  ADZUNA_APP_ID: z.string().min(1),
  ADZUNA_APP_KEY: z.string().min(1),
  SLACK_WEBHOOK_URL: z.string().url().startsWith("https://hooks.slack.com/"),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().min(40).optional(),
  VAPID_PRIVATE_KEY: z.string().min(40).optional(),
  VAPID_SUBJECT: z.string().startsWith("mailto:").optional(),
  PUSH_SUBSCRIPTION_ENCRYPTION_KEY: z.string().min(40).optional(),
  PUSH_POLICY_V2_ENABLED: z.enum(["true", "false"]).optional(),
  SENTRY_DSN: z.string().url().optional(),
});

let cache: z.infer<typeof serverEnvSchema> | undefined;

export function serverEnv(): z.infer<typeof serverEnvSchema> {
  cache ??= serverEnvSchema.parse(process.env);
  return cache;
}
