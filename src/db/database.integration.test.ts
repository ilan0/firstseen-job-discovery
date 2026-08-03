// @vitest-environment node

import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { createClient, type User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

dotenv.config({ path: ".env.local", quiet: true });

const enabled = process.env.RUN_DATABASE_TESTS === "true";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";

describe.runIf(enabled)("database authorization", () => {
  const admin = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const password = `${randomUUID()}Aa9!`;
  const users: User[] = [];
  const clients = [
    createClient(url, publishableKey, { auth: { autoRefreshToken: false, persistSession: false } }),
    createClient(url, publishableKey, { auth: { autoRefreshToken: false, persistSession: false } }),
  ];

  beforeAll(async () => {
    for (let index = 0; index < 2; index += 1) {
      const email = `rls-${index}-${randomUUID()}@firstseen.local`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) throw error;
      users.push(data.user);

      const { error: signInError } = await clients[index]!.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) throw signInError;
      const { error: insertError } = await admin.from("companies").insert({
        user_id: data.user.id,
        name: `RLS Company ${index}`,
        normalized_name: `rls-company-${index}-${randomUUID()}`,
        origin: "manual",
      });
      if (insertError) throw insertError;
    }
  });

  afterAll(async () => {
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
  });

  it("limits authenticated reads to the owning user", async () => {
    const { data, error } = await clients[0]!.from("companies").select("user_id,name");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.user_id).toBe(users[0]?.id);
    expect(data?.[0]?.name).toBe("RLS Company 0");
  });

  it("prevents direct browser-role writes", async () => {
    const { error } = await clients[0]!.from("companies").insert({
      user_id: users[0]!.id,
      name: "Unauthorized direct write",
      normalized_name: `unauthorized-${randomUUID()}`,
      origin: "manual",
    });

    expect(error).not.toBeNull();
  });

  it("denies anonymous table access entirely", async () => {
    const anonymous = createClient(url, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await anonymous.from("companies").select("id");

    expect(error?.code).toBe("42501");
    expect(data).toBeNull();
  });
});
