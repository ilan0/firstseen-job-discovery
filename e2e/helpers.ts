import { execFileSync } from "node:child_process";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";

dotenv.config({ path: ".env.local", quiet: true });

export function ownerAccessCode() {
  let code = process.env.E2E_ACCESS_CODE;
  if (!code && process.platform === "darwin")
    code = execFileSync(
      "security",
      [
        "find-generic-password",
        "-a",
        "ilannabatkhorian",
        "-s",
        "firstseen-local-access-code",
        "-w",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  if (!code || !/^\d{4}$/.test(code)) throw new Error("E2E access code is unavailable");
  return code;
}

export async function signIn(page: Page) {
  const code = ownerAccessCode();
  await page.goto("/");
  await page.locator("form[data-hydrated='true']").waitFor();
  await page.getByLabel("Access code", { exact: true }).fill(code);
  await page.getByRole("button", { name: "Open FirstSeen", exact: true }).click();
  await page.getByRole("heading", { name: "Fresh matches" }).waitFor();
}

export async function resetLocalRateLimits() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost):/.test(url))
    throw new Error("E2E rate-limit reset is local-only");
  const admin = createClient(url, process.env.SUPABASE_SECRET_KEY ?? "", {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const result = await admin.from("security_rate_limits").delete().neq("namespace", "__never__");
  if (result.error) throw result.error;
}

export function observeFailures(page: Page) {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console:${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`page:${error.name}`));
  page.on("response", (response) => {
    if (response.status() >= 400)
      failures.push(`http:${response.status()}:${new URL(response.url()).pathname}`);
  });
  return failures;
}
