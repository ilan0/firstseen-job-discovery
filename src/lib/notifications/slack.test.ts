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
      },
      "https://firstseen.example",
    );
    expect(payload.text).toContain("Exceptional");
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
