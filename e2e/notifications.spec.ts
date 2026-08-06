import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { observeFailures, signIn } from "./helpers";

test("Push-first notification policy, overrides, and responsive settings", async ({ page }) => {
  test.setTimeout(90_000);
  const failures = observeFailures(page);
  await signIn(page);
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Push notifications" })).toBeVisible();
  await expect(page.getByText("while the app is closed", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /Balanced/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("button", { name: /All viable/ }).click();
  await expect(page.getByRole("button", { name: /All viable/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const advanced = page.locator("details").filter({ hasText: "Advanced rules" });
  if ((await advanced.getAttribute("open")) === null) await advanced.locator("summary").click();
  await advanced.getByLabel("Possible freshness").selectOption("3");
  await expect(advanced.getByText("Custom", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save alert policy" }).click();
  await expect(page.getByRole("status")).toContainText("Notification policy saved");

  await page.reload();
  const restoredAdvanced = page.locator("details").filter({ hasText: "Advanced rules" });
  await expect(restoredAdvanced).toHaveAttribute("open", "");
  await expect(restoredAdvanced.getByLabel("Possible freshness")).toHaveValue("3");

  await page.getByRole("button", { name: "Preview policy" }).click();
  await expect(page.getByText(/alerts from \d+ recently evaluated jobs/)).toBeVisible();

  const companyOverride = page.locator("select[aria-label^='Alert rule for']").first();
  if ((await companyOverride.count()) > 0) {
    await companyOverride.selectOption("mute");
    await expect(page.getByRole("status")).toContainText("Company alert rule saved");
    await expect(companyOverride).toHaveValue("mute");
    await companyOverride.selectOption("global");
    await expect(companyOverride).toHaveValue("global");
  }

  const accessibility = await new AxeBuilder({ page }).include("main").analyze();
  expect(accessibility.violations).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);

  await page.getByRole("button", { name: /Balanced/ }).click();
  await page.getByRole("button", { name: "Save alert policy" }).click();
  await expect(page.getByRole("status")).toContainText("Notification policy saved");
  expect(failures).toEqual([]);
});
