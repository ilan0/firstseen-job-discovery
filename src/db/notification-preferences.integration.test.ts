// @vitest-environment node
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { createClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

dotenv.config({ path: ".env.local", quiet: true });

const enabled = process.env.RUN_DATABASE_TESTS === "true";
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.SUPABASE_SECRET_KEY ?? "",
  { auth: { autoRefreshToken: false, persistSession: false } },
);

describe.runIf(enabled)("notification preference integrity", () => {
  let user: User | null = null;
  let channelId: string;

  beforeAll(async () => {
    const created = await admin.auth.admin.createUser({
      email: `notification-integrity-${randomUUID()}@firstseen.local`,
      password: `${randomUUID()}Aa9!`,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    user = created.data.user;
    const channel = await admin
      .from("notification_channels")
      .insert({ user_id: user.id, kind: "web_push", label: "Browser push" })
      .select("id")
      .single();
    if (channel.error) throw channel.error;
    channelId = channel.data.id;
  });

  afterAll(async () => {
    if (user) await admin.auth.admin.deleteUser(user.id);
  });

  it("permits exactly one null-organization preference per channel", async () => {
    const first = await admin
      .from("notification_preferences")
      .insert({ user_id: user!.id, channel_id: channelId });
    expect(first.error).toBeNull();
    const duplicate = await admin
      .from("notification_preferences")
      .insert({ user_id: user!.id, channel_id: channelId });
    expect(duplicate.error?.code).toBe("23505");
    const rows = await admin
      .from("notification_preferences")
      .select("id")
      .eq("channel_id", channelId)
      .is("organization_id", null);
    expect(rows.error).toBeNull();
    expect(rows.data).toHaveLength(1);
  });
});
