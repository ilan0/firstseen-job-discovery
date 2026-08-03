import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";
import { postSlackWebhook } from "@/lib/notifications/slack-webhook";

const values = parse(readFileSync(resolve(".env.local"), "utf8"));
const webhook = values.SLACK_WEBHOOK_URL;
if (!webhook) throw new Error("Slack smoke configuration is missing");
try {
  const result = await postSlackWebhook(webhook, {
    text: "FirstSeen setup: Slack delivery verified.",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "✅ *FirstSeen setup check passed*\nThe private job-discovery app can deliver alerts and morning digests here.",
        },
      },
    ],
  });
  console.log(JSON.stringify({ ok: true, status: result.status }));
} catch (error) {
  const value = error as { name?: string };
  console.error(JSON.stringify({ ok: false, code: value.name ?? "UNKNOWN" }));
  process.exitCode = 1;
}
