import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { observeFailures, ownerAccessCode, resetLocalRateLimits, signIn } from "./helpers";

test("access-code gate fails safely and sign-out returns to it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-390", "Rate-limit behavior is viewport-independent");
  await resetLocalRateLimits();
  const failures = observeFailures(page);
  const code = ownerAccessCode();
  const wrongCode = String((Number(code) + 1) % 10_000).padStart(4, "0");
  await page.goto("/");
  await page.locator("form[data-hydrated='true']").waitFor();
  const codeInput = page.getByLabel("Access code", { exact: true });
  await expect(codeInput).toBeFocused();
  await codeInput.fill("123");
  await page.getByRole("button", { name: "Open FirstSeen", exact: true }).click();
  await expect(page.locator("p[role='alert']")).toHaveText("Enter all four digits.");
  await codeInput.fill(wrongCode);
  await page.getByRole("button", { name: "Open FirstSeen", exact: true }).click();
  await expect(page.locator("p[role='alert']")).toHaveText("That code isn't right. Try again.");
  await codeInput.fill(code);
  await page.getByRole("button", { name: "Open FirstSeen", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Fresh matches" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Access code", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in(?:\?.*)?$/);
  expect(failures).toEqual([]);
});

test("sign-in, explainable match, filters, and persistent queue transitions", async ({ page }) => {
  test.setTimeout(60_000);
  const failures = observeFailures(page);
  await signIn(page);
  if ((page.viewportSize()?.width ?? 1440) < 1024) {
    const mobileNav = page.getByRole("navigation", { name: "Primary mobile" });
    for (const name of [
      "Matches",
      "Saved",
      "Applications",
      "Dismissed",
      "Watchlist",
      "People",
      "Health",
      "Settings",
    ])
      await expect(mobileNav.getByRole("link", { name })).toBeInViewport();
  }
  await expect(page.getByText("FirstSeen QA Fixture")).toBeVisible();
  const searchInput = page.getByRole("textbox", { name: "Search jobs", exact: true });
  await searchInput.fill("no matching role exists");
  await expect(page.getByText("No fresh verified matches")).toBeVisible();
  await page.getByRole("button", { name: "Reset filters" }).click();
  await expect(searchInput).toHaveValue("");
  await page.getByRole("combobox", { name: "Sort jobs" }).selectOption("detected_newest");
  await page.getByRole("button", { name: "Reset filters" }).click();
  const officialOpenPath = await page
    .locator("article")
    .filter({ hasText: "FirstSeen QA Fixture" })
    .getByRole("link", { name: "Official apply", exact: false })
    .getAttribute("href");
  expect(officialOpenPath).toBeTruthy();
  const officialResponse = await page.request.get(officialOpenPath!, { maxRedirects: 0 });
  expect(officialResponse.status()).toBe(303);
  expect(officialResponse.headers().location).toBe("https://jobs.lever.co/firstseen-qa/qa-swe-1");
  const detailPath = officialOpenPath!.replace(/\/open$/, "");
  await page.goto(detailPath);
  await expect(page.getByText("Did you submit this application?", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue later", exact: true }).click();
  await expect(page.getByText("Ready to finish this application?", { exact: true })).toBeVisible();
  await page.goto("/");
  const resumable = page.locator("section").filter({ hasText: "Applications waiting for you" });
  await expect(resumable).toContainText("Software Engineer I");
  await resumable.getByRole("link").filter({ hasText: "Software Engineer I" }).click();
  await expect(page.getByText("Ready to finish this application?", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss prompt", exact: true }).click();
  await expect(page.getByText("Ready to finish this application?", { exact: true })).toBeHidden();
  await page.goto("/");
  await page.getByRole("combobox", { name: "Filter match type" }).selectOption("strong");
  await page.getByRole("checkbox", { name: "Referrals" }).check();
  await expect(page).toHaveURL(/band=strong/);
  await expect(page).toHaveURL(/referrals=true/);
  await expect(page.getByText(/^Showing \d+ jobs$/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Filter match type" })).toHaveValue("strong");
  await expect(page.getByRole("checkbox", { name: "Referrals" })).toBeChecked();
  const filteredFixture = page.locator("article").filter({ hasText: "FirstSeen QA Fixture" });
  const fixtureTitle = filteredFixture.getByRole("link", {
    name: "Software Engineer I",
    exact: true,
  });
  await expect(fixtureTitle).toBeVisible();
  await fixtureTitle.click();
  await expect(page.getByRole("heading", { name: "Explainable dimensions" })).toBeVisible();
  await expect(page.getByText("Security clearance", { exact: true })).toBeVisible();
  await expect(page.getByText("not required", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Save for later", exact: true }).click();
  await expect(page.getByRole("button", { name: "Restore to active", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore to active", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save for later", exact: true })).toBeVisible();
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

  await page
    .locator("article")
    .filter({ hasText: "FirstSeen QA Fixture" })
    .getByRole("button", { name: "Applied", exact: true })
    .click();
  await expect(page.locator("article").filter({ hasText: "FirstSeen QA Fixture" })).toBeHidden();
  await page.goto("/applied");
  const appliedFixture = page.locator("article").filter({ hasText: "FirstSeen QA Fixture" });
  await expect(appliedFixture).toBeVisible();
  await page.reload();
  await appliedFixture.getByRole("link", { name: "Job detail", exact: true }).click();
  await page.getByRole("button", { name: "Restore to active", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save for later", exact: true })).toBeVisible();

  await page.goto("/");
  await page
    .locator("article")
    .filter({ hasText: "FirstSeen QA Fixture" })
    .getByRole("button", { name: "Dismiss", exact: true })
    .click();
  await expect(page.locator("article").filter({ hasText: "FirstSeen QA Fixture" })).toBeHidden();
  await page.goto("/dismissed");
  const dismissedFixture = page.locator("article").filter({ hasText: "FirstSeen QA Fixture" });
  await expect(dismissedFixture).toBeVisible();
  await page.reload();
  await dismissedFixture.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(dismissedFixture).toBeHidden();
  await page.goto("/");
  await expect(page.getByText("FirstSeen QA Fixture")).toBeVisible();
  expect(failures).toEqual([]);
});

test("watchlist validation is recoverable and core pages are accessible", async ({ page }) => {
  const failures = observeFailures(page);
  await signIn(page);
  await page.goto("/watchlist");
  await expect(page.getByRole("link", { name: /My companies/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByText("FirstSeen QA Discovery")).toBeHidden();
  await page.getByRole("link", { name: /Discovered companies/ }).click();
  const automaticFixture = page.locator("article").filter({ hasText: "FirstSeen QA Discovery" });
  await expect(automaticFixture).toContainText("Automatic");
  await expect(automaticFixture).toContainText("Found by brave");
  await automaticFixture.getByRole("button", { name: "Mark interested" }).click();
  await expect(automaticFixture.getByRole("button", { name: "Interested" })).toBeVisible();
  await expect(automaticFixture).toContainText("Every 15 minutes");
  await automaticFixture.getByRole("button", { name: "Interested" }).click();
  await expect(automaticFixture.getByRole("button", { name: "Mark interested" })).toBeVisible();
  await expect(automaticFixture).toContainText("Every 240 minutes");
  await automaticFixture.getByPlaceholder("Add referral person").fill("QA Auto Referral");
  await automaticFixture.getByRole("button", { name: "Add", exact: true }).click();
  const automaticReferral = automaticFixture.getByText(/Referral: QA Auto Referral/);
  await expect(automaticReferral).toBeVisible();
  await expect(automaticFixture).toContainText("Every 15 minutes");
  await automaticReferral.locator("xpath=..").getByRole("button", { name: "Remove" }).click();
  await expect(automaticReferral).toBeHidden();
  await expect(automaticFixture).toContainText("Every 240 minutes");
  await page.getByRole("link", { name: /My companies/ }).click();
  await page.getByRole("textbox", { name: "Company name", exact: true }).fill("Unsupported QA");
  await page
    .getByRole("textbox", { name: "Official careers or ATS URL", exact: true })
    .fill("https://example.com");
  await page.getByRole("button", { name: "Start monitoring", exact: true }).click();
  await expect(page.getByText("not a recognized official ATS", { exact: false })).toBeVisible();

  await page.getByRole("textbox", { name: "Company name", exact: true }).fill("QA Monitored");
  await page
    .getByRole("textbox", { name: "Official careers or ATS URL", exact: true })
    .fill("https://boards.greenhouse.io/figma");
  await page
    .getByRole("textbox", { name: "Referral person (optional)", exact: true })
    .fill("QA Referral");
  await page.getByRole("combobox", { name: "Priority", exact: true }).selectOption("1");
  await page.getByRole("textbox", { name: "Notes", exact: true }).fill("Browser audit fixture");
  await page.getByRole("button", { name: "Start monitoring", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("QA Monitored");
  await expect(page.getByRole("textbox", { name: "Company name", exact: true })).toHaveValue("");
  const watchedCompany = page.locator("article").filter({ hasText: "QA Monitored" });
  await expect(watchedCompany).toContainText("QA Referral");
  await expect(watchedCompany.getByRole("link", { name: "Official source" })).toHaveAttribute(
    "href",
    "https://boards.greenhouse.io/figma",
  );
  await watchedCompany.getByRole("button", { name: "Stop monitoring", exact: true }).click();
  const removeDialog = page.getByRole("dialog", { name: "Are you sure?" });
  await expect(removeDialog).toBeVisible();
  const dialogAccessibility = await new AxeBuilder({ page }).include("dialog").analyze();
  expect(dialogAccessibility.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(removeDialog).toBeHidden();
  await expect(
    watchedCompany.getByRole("button", { name: "Stop monitoring", exact: true }),
  ).toBeFocused();
  await watchedCompany.getByRole("button", { name: "Stop monitoring", exact: true }).click();
  await removeDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(watchedCompany).toBeVisible();
  await watchedCompany.getByRole("button", { name: "Stop monitoring", exact: true }).click();
  await removeDialog.getByRole("button", { name: "Stop monitoring", exact: true }).click();
  await expect(watchedCompany).toBeHidden();
  for (const route of [
    "/",
    "/saved",
    "/applied",
    "/dismissed",
    "/watchlist",
    "/relationships",
    "/applications/packet",
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
  expect(exported).toMatchObject({ status: 200, version: 2, hasCompanies: true });
  expect(exported.disposition).toContain("firstseen-export-");
  await page.goto("/settings");
  await page.getByRole("checkbox", { name: "Morning digest" }).uncheck();
  await page.getByRole("combobox", { name: "Digest hour (Eastern)" }).selectOption("9");
  await page.getByRole("button", { name: "Save notification settings" }).click();
  await expect(page.getByRole("status")).toHaveText("Notification settings saved.");
  await expect(page.getByRole("checkbox", { name: "Morning digest" })).not.toBeChecked();
  await expect(page.getByRole("combobox", { name: "Digest hour (Eastern)" })).toHaveValue("9");
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Morning digest" })).not.toBeChecked();
  await expect(page.getByRole("combobox", { name: "Digest hour (Eastern)" })).toHaveValue("9");
  await page.getByRole("checkbox", { name: "Morning digest" }).check();
  await page.getByRole("combobox", { name: "Digest hour (Eastern)" }).selectOption("8");
  await page.getByRole("combobox", { name: "Default posted-date window" }).selectOption("24h");
  await page
    .getByRole("combobox", { name: "Default match ordering" })
    .selectOption("detected_newest");
  await page.getByRole("button", { name: "Save notification settings" }).click();
  await expect(page.getByRole("status")).toHaveText("Notification settings saved.");
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "Posted within" })).toHaveValue("24h");
  await expect(page.getByRole("combobox", { name: "Sort jobs" })).toHaveValue("detected_newest");
  await page.getByRole("combobox", { name: "Posted within" }).selectOption("6h");
  await expect(page).toHaveURL(/postedWithin=6h/);
  await page.getByRole("button", { name: "Reset filters" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("combobox", { name: "Posted within" })).toHaveValue("24h");
  await expect(page.getByRole("combobox", { name: "Sort jobs" })).toHaveValue("detected_newest");
  await page.goto("/settings");
  await page.getByRole("combobox", { name: "Default posted-date window" }).selectOption("7d");
  await page
    .getByRole("combobox", { name: "Default match ordering" })
    .selectOption("posted_newest");
  await page.getByRole("button", { name: "Save notification settings" }).click();
  await expect(page.getByRole("status")).toHaveText("Notification settings saved.");

  await page.getByRole("button", { name: "Permanently delete account" }).click();
  const accountDialog = page.getByRole("dialog", { name: "Are you sure?" });
  await expect(accountDialog).toBeVisible();
  await expect(accountDialog).toContainText("cannot be undone");
  await accountDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(accountDialog).toBeHidden();
  expect(failures).toEqual([]);
});
