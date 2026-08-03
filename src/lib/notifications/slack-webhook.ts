import type { SlackPayload } from "./slack-payload";

export type SlackFetch = typeof fetch;

export async function postSlackWebhook(
  webhookValue: string,
  payload: SlackPayload,
  fetcher: SlackFetch = fetch,
) {
  const webhook = new URL(webhookValue);
  if (
    webhook.protocol !== "https:" ||
    webhook.hostname !== "hooks.slack.com" ||
    webhook.username ||
    webhook.password
  )
    throw new Error("Invalid Slack webhook destination");
  const response = await fetcher(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Slack webhook returned ${response.status}`);
  return { status: response.status };
}
