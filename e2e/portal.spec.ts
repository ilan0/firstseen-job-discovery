import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { observeFailures, signIn } from "./helpers";

test("sign-in, explainable match, filters, and persistent queue transitions", async ({ page }) => {
  const failures = observeFailures(page);
  await signIn(page);
  if ((page.viewportSize()?.width ?? 1440) < 1024) {
    const mobileNav = page.getByRole("navigation", { name: "Primary mobile" });
    for (const name of [
      "Matches",
      "Saved",
      "Applied",
      "Dismissed",
      "Watchlist",
      "Health",
      "Settings",
    ])
      await expect(mobileNav.getByRole("link", { name })).toBeInViewport();
  }
  await expect(page.getByText("FirstSeen QA Fixture")).toBeVisible();
  await page.getByRole("combobox", { name: "Filter match type" }).selectOption("hot");
  await page.getByRole("checkbox", { name: "Referrals" }).check();
  const filteredFixture = page.locator("article").filter({ hasText: "FirstSeen QA Fixture" });
  const fixtureTitle = filteredFixture.getByRole("link", {
    name: "Software Engineer I",
    exact: true,
  });
  await expect(fixtureTitle).toBeVisible();
  await fixtureTitle.click();
  await expect(page.getByRole("heading", { name: "Explainable dimensions" })).toBeVisible();
  await expect(page.getByText("security clearance", { exact: false })).toHaveCount(0);
  await page.goto("/");
  const activeFixture = page.locator("article").filter({ hasText: "FirstSeen QA Fixture" });
  await activeFixture.getByRole("button", { name: "Save", exact: true }).click();
  await expect(activeFixture).toBeHidden();
  await page.goto("/saved");
  await page.reload();
  const savedFixture = page.locator("article").filter({ hasText: "FirstSeen QA Fixture" });
  await expect(savedFixture).toBeVisible();
  await savedFixture.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(savedFixture).toBeHidden();
  await page.goto("/");
  await expect(page.getByText("FirstSeen QA Fixture")).toBeVisible();
  expect(failures).toEqual([]);
});

test("watchlist validation is recoverable and core pages are accessible", async ({ page }) => {
  const failures = observeFailures(page);
  await signIn(page);
  await page.goto("/watchlist");
  await page.getByRole("textbox", { name: "Company name", exact: true }).fill("Unsupported QA");
  await page
    .getByRole("textbox", { name: "Official careers or ATS URL", exact: true })
    .fill("https://example.com");
  await page.getByRole("button", { name: "Start monitoring", exact: true }).click();
  await expect(page.getByText("not a recognized official ATS", { exact: false })).toBeVisible();
  for (const route of [
    "/",
    "/saved",
    "/applied",
    "/dismissed",
    "/watchlist",
    "/operations",
    "/settings",
  ]) {
    await page.goto(route);
    await expect(page.locator("main h1")).toBeVisible();
    const results = await new AxeBuilder({ page }).include("main").analyze();
    expect(
      results.violations,
      `${route}: ${results.violations.map((item) => item.id).join(",")}`,
    ).toEqual([]);
  }
  const exported = await page.evaluate(async () => {
    const response = await fetch("/settings/export");
    const body = (await response.json()) as {
      exportVersion?: number;
      data?: Record<string, unknown[]>;
    };
    return {
      status: response.status,
      disposition: response.headers.get("content-disposition"),
      version: body.exportVersion,
      hasCompanies: Array.isArray(body.data?.companies),
    };
  });
  expect(exported).toMatchObject({ status: 200, version: 1, hasCompanies: true });
  expect(exported.disposition).toContain("firstseen-export-");
  await page.getByRole("button", { name: "Save notification settings" }).click();
  await expect(page.getByRole("status")).toHaveText("Notification settings saved.");
  expect(failures).toEqual([]);
});
