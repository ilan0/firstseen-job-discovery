// @vitest-environment node

import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

dotenv.config({ path: ".env.local", quiet: true });

const enabled = process.env.RUN_DATABASE_TESTS === "true";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";

describe.runIf(enabled)("daily-driver v2 authorization", () => {
  const admin = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const users: User[] = [];
  const clients: SupabaseClient[] = [];
  const password = `${randomUUID()}Aa9!`;
  let organizationId = "";

  beforeAll(async () => {
    const organization = await admin
      .from("organizations")
      .insert({
        name: "Daily Driver RLS",
        normalized_name: `daily-driver-rls-${randomUUID()}`,
      })
      .select("id")
      .single();
    if (organization.error) throw organization.error;
    organizationId = organization.data.id;

    for (let index = 0; index < 2; index += 1) {
      const email = `daily-driver-${index}-${randomUUID()}@firstseen.local`;
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (created.error) throw created.error;
      users.push(created.data.user);
      const client = createClient(url, publishableKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const signedIn = await client.auth.signInWithPassword({ email, password });
      if (signedIn.error) throw signedIn.error;
      clients.push(client);

      const contact = await admin
        .from("contacts")
        .insert({
          user_id: created.data.user.id,
          name: `Private Contact ${index}`,
          relationship_strength: index + 2,
        })
        .select("id")
        .single();
      if (contact.error) throw contact.error;
      const channel = await admin
        .from("notification_channels")
        .insert({
          user_id: created.data.user.id,
          kind: "web_push",
          label: `Device ${index}`,
        })
        .select("id")
        .single();
      if (channel.error) throw channel.error;
      const subscription = await admin.from("push_subscriptions").insert({
        user_id: created.data.user.id,
        channel_id: channel.data.id,
        endpoint_hash: randomUUID(),
        encrypted_capability: `encrypted-${index}`,
      });
      if (subscription.error) throw subscription.error;
      const follow = await admin.from("user_company_follows").insert({
        user_id: created.data.user.id,
        organization_id: organizationId,
        interested: index === 0,
      });
      if (follow.error) throw follow.error;
    }
  });

  afterAll(async () => {
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
    if (organizationId) await admin.from("organizations").delete().eq("id", organizationId);
  });

  it("isolates contacts, follows, and encrypted push capabilities by owner", async () => {
    const contacts = await clients[0]!.from("contacts").select("user_id,name");
    expect(contacts.error).toBeNull();
    expect(contacts.data).toEqual([{ user_id: users[0]!.id, name: "Private Contact 0" }]);

    const follows = await clients[0]!.from("user_company_follows").select("user_id,interested");
    expect(follows.data).toEqual([{ user_id: users[0]!.id, interested: true }]);

    const subscriptions = await clients[0]!
      .from("push_subscriptions")
      .select("user_id,encrypted_capability");
    expect(subscriptions.data).toEqual([
      { user_id: users[0]!.id, encrypted_capability: "encrypted-0" },
    ]);
  });

  it("keeps global supply service-only and rejects direct private writes", async () => {
    const globalRead = await clients[0]!.from("organizations").select("id");
    expect(globalRead.error?.code).toBe("42501");
    expect(globalRead.data).toBeNull();

    const privateWrite = await clients[0]!.from("contacts").insert({
      user_id: users[0]!.id,
      name: "Browser write",
    });
    expect(privateWrite.error?.code).toBe("42501");
  });
});
