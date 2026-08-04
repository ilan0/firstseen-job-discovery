import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { observeFailures, signIn } from "./helpers";

test("relationship capture, packet workflow, and PWA offline recovery", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(90_000);
  const failures = observeFailures(page);
  const contactName = `QA Person ${testInfo.project.name} ${Date.now()}`;
  await signIn(page);

  await page.goto("/relationships");
  await page.getByLabel("Name", { exact: true }).fill(contactName);
  await page.locator("select[name='companyId']").selectOption({ label: "FirstSeen QA Fixture" });
  await page.getByLabel("Title", { exact: true }).fill("Software Engineer");
  await page.locator("select[name='relationshipStrength']").selectOption("4");
  await page.locator("select[name='methodKind']").selectOption("email");
  await page.getByLabel("Contact value", { exact: true }).fill("qa-person@example.test");
  await page.getByRole("button", { name: "Add person", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(`${contactName} was added`);
  const person = page.locator("article").filter({ hasText: contactName });
  await expect(person).toContainText("Strength 4/5");
  await expect(person).toContainText("Referral available");
  await person.getByLabel(`Referral status with ${contactName}`).selectOption("requested");
  await person.getByRole("button", { name: "Save", exact: true }).click();
  await expect(person).toContainText("Referral requested");
  await person.locator("summary").filter({ hasText: "Log interaction" }).click();
  await person.getByLabel(`Interaction type with ${contactName}`).fill("Message");
  await person.getByLabel(`Interaction summary with ${contactName}`).fill("Asked about the team.");
  await person.getByRole("button", { name: "Log interaction", exact: true }).click();
  await expect(person).toContainText("Asked about the team.");

  await page.goto("/applications/packet");
  const resumeLabel = `QA resume ${testInfo.project.name} ${Date.now()}`;
  await page.getByPlaceholder("General SWE · Aug 2026").fill(resumeLabel);
  await page.locator('input[name="resume"]').setInputFiles({
    name: `qa-resume-${testInfo.project.name}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from(`%PDF-1.4\n% FirstSeen ${resumeLabel}\n%%EOF\n`),
  });
  await page.getByRole("button", { name: "Save resume version", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(`${resumeLabel} was uploaded privately`);
  const resumeDownload = page.getByRole("link", { name: `Download ${resumeLabel}`, exact: true });
  const resumeDownloadPath = await resumeDownload.getAttribute("href");
  expect(resumeDownloadPath).toBeTruthy();
  const signedDownload = await page.request.get(resumeDownloadPath!, { maxRedirects: 0 });
  expect(signedDownload.status()).toBe(303);
  const resumeRow = page.getByText(resumeLabel, { exact: true }).locator("../..");
  await resumeRow.getByRole("button", { name: "Hide", exact: true }).click();
  const hideDialog = page.getByRole("dialog", { name: "Are you sure?" });
  await hideDialog.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(page.getByText(resumeLabel, { exact: true })).toBeHidden();

  const packetLabel = `Portfolio ${testInfo.project.name} ${Date.now()}`;
  await page.getByPlaceholder("Identity, links, work authorization…").fill("Links");
  await page.getByPlaceholder("Portfolio URL").fill(packetLabel);
  await page.getByPlaceholder("Reusable value or answer").fill("https://example.test/portfolio");
  await page.getByRole("button", { name: "Save answer", exact: true }).click();
  const packetEntry = page.locator("article").filter({ hasText: packetLabel });
  await expect(packetEntry).toContainText("https://example.test/portfolio");
  await packetEntry.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(packetEntry).toBeHidden();

  if (testInfo.project.name === "desktop-1440") {
    await page.goto("/applied");
    let application = page.locator("article").filter({ hasText: "FirstSeen QA Fixture" });
    if ((await application.count()) === 0) {
      await page.goto("/");
      await page.getByRole("link", { name: "Software Engineer I", exact: true }).click();
      await page.getByRole("button", { name: "Mark as applied", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Restore to active", exact: true }),
      ).toBeVisible();
      await page.goto("/applied");
      application = page.locator("article").filter({ hasText: "FirstSeen QA Fixture" });
    }
    if ((await application.getByText("recruiter screen", { exact: true }).count()) === 0) {
      await application
        .getByLabel("Next application stage for Software Engineer I")
        .selectOption("recruiter_screen");
      await application.getByRole("button", { name: "Update stage", exact: true }).click();
    }
    await expect(application).toContainText("recruiter screen");
    const dueDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await application
      .getByLabel("Follow-up action for Software Engineer I")
      .fill("Send recruiter thank-you");
    await application.getByLabel("Follow-up date for Software Engineer I").fill(dueDate);
    await application.getByRole("button", { name: "Schedule", exact: true }).click();
    await expect(application).toContainText("Send recruiter thank-you");
    let details = application.locator("details").filter({ hasText: "Application details" });
    if ((await details.getAttribute("open")) === null) {
      await details.locator("summary").click();
    }
    const referralValue = await details
      .getByLabel("Referral used")
      .locator("option")
      .filter({ hasText: contactName })
      .getAttribute("value");
    expect(referralValue).toBeTruthy();
    await details.locator("select[name='referralRequestId']").selectOption(referralValue!);
    await details.locator("textarea[name='notes']").fill("Submitted with referral context.");
    await details.getByRole("button", { name: "Save application details", exact: true }).click();
    await page.reload();
    application = page.locator("article").filter({ hasText: "FirstSeen QA Fixture" });
    details = application.locator("details").filter({ hasText: "Application details" });
    if ((await details.getAttribute("open")) === null) {
      await details.locator("summary").click();
    }
    await expect(details).toHaveAttribute("open", "");
    await expect(details.locator("textarea[name='notes']")).toHaveValue(
      "Submitted with referral context.",
    );
    await application.getByRole("link", { name: "Job detail", exact: true }).click();
    const restore = page.getByRole("button", { name: "Restore to active", exact: true });
    if (await restore.isVisible()) await restore.click();
  }

  const pwa = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const manifest = (await (await fetch("/manifest.webmanifest")).json()) as {
      display?: string;
      start_url?: string;
    };
    return {
      active: Boolean(registration.active),
      caches: await caches.keys(),
      display: manifest.display,
      startUrl: manifest.start_url,
    };
  });
  expect(pwa).toMatchObject({ active: true, display: "standalone", startUrl: "/" });
  expect(pwa.caches.every((name) => name.startsWith("firstseen-static-"))).toBe(true);
  await page.goto("/offline");
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "You’re offline" })).toBeVisible();
  await context.setOffline(false);
  await page.reload();
  const accessibility = await new AxeBuilder({ page }).include("main").analyze();
  expect(accessibility.violations).toEqual([]);

  await page.goto("/relationships");
  const savedPerson = page.locator("article").filter({ hasText: contactName });
  await savedPerson.getByRole("button", { name: "Archive", exact: true }).click();
  const archiveDialog = page.getByRole("dialog", { name: "Are you sure?" });
  await archiveDialog.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(savedPerson).toBeHidden();
  expect(failures).toEqual([]);
});
