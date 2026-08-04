import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local", quiet: true });

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing ${key}; run pnpm env:local first.`);
  return value;
}

const email = required("OWNER_EMAIL");
const service = "firstseen-local-owner-password";
let password: string;

try {
  password = execFileSync(
    "security",
    ["find-generic-password", "-a", process.env.USER ?? "firstseen", "-s", service, "-w"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
} catch {
  password = `${randomBytes(24).toString("base64url")}Aa9!`;
  execFileSync(
    "security",
    [
      "add-generic-password",
      "-a",
      process.env.USER ?? "firstseen",
      "-s",
      service,
      "-w",
      password,
      "-U",
    ],
    { stdio: "ignore" },
  );
}

const supabase = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SECRET_KEY"),
  {
    auth: { autoRefreshToken: false, persistSession: false },
  },
);

const { data: listed, error: listError } = await supabase.auth.admin.listUsers({ perPage: 100 });
if (listError) throw listError;

const existing = listed.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
if (existing) {
  const { error } = await supabase.auth.admin.updateUserById(existing.id, {
    password,
    email_confirm: true,
  });
  if (error) throw error;
  console.log("Local owner account already existed and its internal credential was synchronized.");
} else {
  const { error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  console.log("Local owner account created; its internal credential is stored in macOS Keychain.");
}
