import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";

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
  await page.getByLabel("Access code", { exact: true }).fill(code);
  await page.getByRole("button", { name: "Open FirstSeen", exact: true }).click();
  await page.getByRole("heading", { name: "Today’s matches" }).waitFor();
}

export function observeFailures(page: Page) {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console:${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`page:${error.name}`));
  page.on("response", (response) => {
    if (response.status() >= 500)
      failures.push(`http:${response.status()}:${new URL(response.url()).pathname}`);
  });
  return failures;
}
