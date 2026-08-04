import { createHash } from "node:crypto";
import { z } from "zod";

export const pushCapabilitySchema = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2_000),
  expirationTime: z.number().int().positive().nullable(),
  keys: z.object({
    p256dh: z
      .string()
      .min(40)
      .max(200)
      .regex(/^[A-Za-z0-9_-]+$/),
    auth: z
      .string()
      .min(16)
      .max(100)
      .regex(/^[A-Za-z0-9_-]+$/),
  }),
});

export type PushCapability = z.infer<typeof pushCapabilitySchema>;

const endpointHosts = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "web.push.apple.com",
  "notify.windows.com",
]);

export function assertSupportedPushEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    throw new Error("Push endpoint must use provider HTTPS defaults.");
  if (!endpointHosts.has(hostname) && !hostname.endsWith(".notify.windows.com"))
    throw new Error("Push endpoint provider is not supported.");
  return url.toString();
}

export function pushEndpointHash(endpoint: string) {
  return createHash("sha256").update(endpoint).digest("hex");
}
