import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("capture verified responsive queue", async ({ page }, testInfo) => {
  await signIn(page);
  await expect(page.getByText("FirstSeen QA Fixture")).toBeVisible();
  await mkdir("tmp/visual-qa", { recursive: true });
  await page.screenshot({ path: `tmp/visual-qa/${testInfo.project.name}.png`, fullPage: true });
  const detailUrl = await page
    .getByRole("link", { name: "Software Engineer I", exact: true })
    .getAttribute("href");
  expect(detailUrl).toBeTruthy();
  if (!detailUrl) throw new Error("Fixture detail URL is unavailable");
  const visualRoutes: Array<[string, string]> = [
    ["job-detail", detailUrl],
    ["watchlist", "/watchlist"],
    ["health", "/operations"],
    ["settings", "/settings"],
    ["saved-empty", "/saved"],
  ];
  for (const [name, url] of visualRoutes) {
    await page.goto(url);
    await expect(page.locator("main h1")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    await page.screenshot({
      path: `tmp/visual-qa/${testInfo.project.name}-${name}.png`,
      fullPage: true,
    });
  }
});
