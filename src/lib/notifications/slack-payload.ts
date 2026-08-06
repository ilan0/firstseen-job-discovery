import { createHash } from "node:crypto";

export type SlackBlock = Record<string, unknown>;
export type SlackPayload = { text: string; blocks?: SlackBlock[] };

export type DigestJob = {
  title: string;
  company: string;
  band: string;
  urgency: number;
  jobId: string;
  hasReferral: boolean;
  officialUrl: string;
  freshnessSection: "just_posted" | "new" | "recent";
  freshnessAgeHours: number;
  freshnessBasis: "posted_at" | "first_seen" | "reopened_at";
  detectionAgeHours: number;
  primaryConcern: string;
};

export function payloadHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function ageLabel(hours: number) {
  if (hours < 1) return "under 1 hour";
  if (hours < 24) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}

function safeText(value: string, maximum = 500) {
  return value
    .slice(0, maximum)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function exceptionalPayload(
  job: {
    title: string;
    company: string;
    headline: string;
    urgency: number;
    jobId: string;
    hasReferral: boolean;
    band: "hot" | "strong";
    officialUrl: string;
    freshnessAgeHours: number;
    freshnessBasis: "posted_at" | "reopened_at";
    primaryConcern: string;
  },
  appUrl: string,
): SlackPayload {
  const age = ageLabel(job.freshnessAgeHours);
  return {
    text: `Fresh ${job.band} match: ${job.title.slice(0, 120)} at ${job.company.slice(0, 100)}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `🔥 ${job.title.slice(0, 140)}`, emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Company*\n${safeText(job.company, 120)}` },
          { type: "mrkdwn", text: `*Fit*\n${job.band.toUpperCase()} · urgency ${job.urgency}` },
          {
            type: "mrkdwn",
            text: `*Freshness*\n${job.freshnessBasis === "reopened_at" ? "Reopened" : "Officially posted"} ${age} ago`,
          },
          {
            type: "mrkdwn",
            text: `*Referral*\n${job.hasReferral ? "Contact available" : "None recorded"}`,
          },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${safeText(job.headline, 1_000)}\n*Primary concern:* ${safeText(job.primaryConcern, 300)}`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Official apply" },
            style: "primary",
            url: job.officialUrl,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Review analysis" },
            url: `${appUrl}/jobs/${job.jobId}`,
          },
        ],
      },
    ],
  };
}

export function digestPayload(jobs: DigestJob[], localDate: string, appUrl: string): SlackPayload {
  const top = jobs.slice(0, 12);
  const sectionNames: Record<DigestJob["freshnessSection"], string> = {
    just_posted: "Just posted (0–24h)",
    new: "New (1–3d)",
    recent: "Recent (3–7d)",
  };
  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Your FirstSeen morning list", emoji: true },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${jobs.length} verified, unacted match${jobs.length === 1 ? "" : "es"} newly detected since your last digest · ${localDate}`,
        },
      ],
    },
  ];
  for (const section of ["just_posted", "new", "recent"] as const) {
    const sectionJobs = top.filter((job) => job.freshnessSection === section);
    if (!sectionJobs.length) continue;
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${sectionNames[section]}*`,
      },
    });
    for (const job of sectionJobs)
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `• *${safeText(job.title, 140)}* — ${safeText(job.company, 100)}\n  ${job.band.toUpperCase()} · ${job.freshnessBasis === "first_seen" ? "verified-sighting age" : "official age"} ${ageLabel(job.freshnessAgeHours)} · detected ${ageLabel(job.detectionAgeHours)} ago${job.hasReferral ? " · 🤝 referral" : ""}\n  Concern: ${safeText(job.primaryConcern, 220)}\n  <${job.officialUrl}|Official apply> · <${appUrl}/jobs/${job.jobId}|Analysis>`,
        },
      });
  }
  if (jobs.length > top.length)
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Plus ${jobs.length - top.length} more in <${appUrl}|FirstSeen>.`,
        },
      ],
    });
  return {
    text: `${jobs.length} fresh FirstSeen matches for ${localDate}`,
    blocks,
  };
}
