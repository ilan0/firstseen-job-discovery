import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("capture verified responsive queue", async ({ page }, testInfo) => {
  await signIn(page);
  await expect(page.getByText("FirstSeen QA Fixture")).toBeVisible();
  await mkdir("tmp/visual-qa", { recursive: true });
  await page.screenshot({ path: `tmp/visual-qa/${testInfo.project.name}.png`, fullPage: true });
});
