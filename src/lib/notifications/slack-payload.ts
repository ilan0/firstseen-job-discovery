import { createHash } from "node:crypto";

export type SlackBlock = Record<string, unknown>;
export type SlackPayload = { text: string; blocks?: SlackBlock[] };

export function payloadHash(payload: SlackPayload): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function exceptionalPayload(
  job: {
    title: string;
    company: string;
    headline: string;
    urgency: number;
    jobId: string;
    hasReferral: boolean;
  },
  appUrl: string,
): SlackPayload {
  return {
    text: `Exceptional match: ${job.title} at ${job.company}`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: `🔥 ${job.title}`, emoji: true } },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Company*\n${job.company}` },
          { type: "mrkdwn", text: `*Urgency*\n${job.urgency}/100` },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${job.headline}${job.hasReferral ? "\n🤝 Referral contact available" : ""}`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Review match" },
            style: "primary",
            url: `${appUrl}/jobs/${job.jobId}`,
          },
        ],
      },
    ],
  };
}

export function digestPayload(
  jobs: Array<{
    title: string;
    company: string;
    band: string;
    urgency: number;
    jobId: string;
    hasReferral: boolean;
  }>,
  localDate: string,
  appUrl: string,
): SlackPayload {
  const top = jobs.slice(0, 12);
  const lines = top
    .map(
      (job, index) =>
        `${index + 1}. *${job.title}* — ${job.company}\n   ${job.band.toUpperCase()} · urgency ${job.urgency}${job.hasReferral ? " · 🤝 referral" : ""} · <${appUrl}/jobs/${job.jobId}|Review>`,
    )
    .join("\n");
  return {
    text: `${jobs.length} fresh FirstSeen matches for ${localDate}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Your FirstSeen morning list", emoji: true },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: jobs.length ? lines : "No new verified matches today. Scans are still running.",
        },
      },
      ...(jobs.length > top.length
        ? [
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `Plus ${jobs.length - top.length} more in <${appUrl}|FirstSeen>.`,
                },
              ],
            },
          ]
        : []),
    ],
  };
}
