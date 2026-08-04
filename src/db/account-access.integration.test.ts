// @vitest-environment node

import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

dotenv.config({ path: ".env.local", quiet: true });
vi.mock("server-only", () => ({}));

const enabled = process.env.RUN_DATABASE_TESTS === "true";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY ?? "", {
  auth: { autoRefreshToken: false, persistSession: false },
});

describe.runIf(enabled)("invite-only account access", () => {
  const users: User[] = [];
  const clients: SupabaseClient[] = [];
  let rogue: User | null = null;
  const password = `${randomUUID()}Aa9!`;

  beforeAll(async () => {
    for (let index = 0; index < 2; index += 1) {
      const email = `allowed-${index}-${randomUUID()}@firstseen.local`;
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error) throw created.error;
      users.push(created.data.user);
      const access = await admin.from("account_access").insert({
        user_id: created.data.user.id,
        email: email.toLowerCase(),
        status: index === 0 ? "active" : "invited",
        role: "member",
      });
      if (access.error) throw access.error;
      const client = createClient(url, publishableKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const signedIn = await client.auth.signInWithPassword({ email, password });
      if (signedIn.error) throw signedIn.error;
      clients.push(client);
    }
    const rogueCreated = await admin.auth.admin.createUser({
      email: `rogue-${randomUUID()}@firstseen.local`,
      password,
      email_confirm: true,
    });
    if (rogueCreated.error) throw rogueCreated.error;
    rogue = rogueCreated.data.user;
  });

  afterAll(async () => {
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
    if (rogue) await admin.auth.admin.deleteUser(rogue.id);
  });

  it("shows only the current account row and denies self-activation", async () => {
    const visible = await clients[0]!.from("account_access").select("user_id,email,status,role");
    expect(visible.error).toBeNull();
    expect(visible.data).toEqual([
      expect.objectContaining({ user_id: users[0]!.id, status: "active", role: "member" }),
    ]);
    const mutation = await clients[1]!
      .from("account_access")
      .update({ status: "active", role: "admin" })
      .eq("user_id", users[1]!.id);
    expect(mutation.error?.code).toBe("42501");
  });

  it("rejects authenticated provider users that are absent from the app allowlist", async () => {
    const { hasAccountAccess } = await import("@/lib/auth/account-access");
    await expect(hasAccountAccess(users[0]!)).resolves.toBe(true);
    await expect(hasAccountAccess(users[1]!)).resolves.toBe(true);
    await expect(hasAccountAccess(rogue!)).resolves.toBe(false);
  });
});
