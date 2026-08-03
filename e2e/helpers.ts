import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";
import type { Page } from "@playwright/test";

export function ownerCredentials() {
  const values = parse(readFileSync(resolve(".env.local"), "utf8"));
  const email = values.OWNER_EMAIL;
  let password = process.env.E2E_OWNER_PASSWORD;
  if (!password && process.platform === "darwin")
    password = execFileSync(
      "security",
      [
        "find-generic-password",
        "-a",
        "ilannabatkhorian",
        "-s",
        "firstseen-local-owner-password",
        "-w",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  if (!email || !password) throw new Error("E2E owner credentials are unavailable");
  return { email, password };
}

export async function signIn(page: Page) {
  const credentials = ownerCredentials();
  await page.goto("/");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(credentials.email);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
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
