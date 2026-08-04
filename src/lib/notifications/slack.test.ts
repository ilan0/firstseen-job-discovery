import { beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/test/test/test";
  process.env.NEXT_PUBLIC_APP_URL = "https://firstseen.example";
});

describe("Slack rendering", () => {
  it("renders an exceptional match with a portal deep link", async () => {
    const { exceptionalPayload } = await import("./slack-payload");
    const payload = exceptionalPayload(
      {
        title: "Software Engineer",
        company: "Example",
        headline: "Fresh fit",
        urgency: 98,
        jobId: "job",
        hasReferral: true,
        band: "hot",
        officialUrl: "https://jobs.example/job",
        freshnessAgeHours: 2,
        freshnessBasis: "posted_at",
        primaryConcern: "Limited React evidence",
      },
      "https://firstseen.example",
    );
    expect(payload.text).toContain("Fresh hot match");
    expect(JSON.stringify(payload)).toContain("/jobs/job");
    expect(JSON.stringify(payload)).toContain("Referral");
  });
  it("caps detailed digest rows", async () => {
    const { digestPayload } = await import("./slack-payload");
    const jobs = Array.from({ length: 14 }, (_, index) => ({
      title: `Role ${index}`,
      company: "Example",
      band: "hot",
      urgency: 90,
      jobId: `${index}`,
      hasReferral: false,
      officialUrl: `https://jobs.example/${index}`,
      freshnessSection:
        index < 4 ? ("just_posted" as const) : index < 9 ? ("new" as const) : ("recent" as const),
      freshnessAgeHours: index + 1,
      freshnessBasis: "posted_at" as const,
      detectionAgeHours: index,
      primaryConcern: "None",
    }));
    const payload = digestPayload(jobs, "2026-08-03", "https://firstseen.example");
    expect(JSON.stringify(payload)).toContain("Plus 2 more");
  });
  it("posts only to the fixed Slack webhook host", async () => {
    const { postSlackWebhook } = await import("./slack-webhook");
    let destination: URL | null = null;
    const fetcher: typeof fetch = vi.fn(async (input) => {
      destination = input as URL;
      return new Response("ok", { status: 200 });
    });
    await postSlackWebhook(
      "https://hooks.slack.com/services/test/test/test",
      { text: "test" },
      fetcher,
    );
    expect(fetcher).toHaveBeenCalledOnce();
    expect(destination).not.toBeNull();
    expect((destination as URL | null)?.hostname).toBe("hooks.slack.com");
  });
});
