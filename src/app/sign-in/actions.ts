"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { serverEnv } from "@/lib/env/server";
import { clearRateLimit, consumeRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SignInState = { error?: string };

const credentialsSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(256),
});

export async function signIn(_: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Enter a valid email and password." };
  const email = parsed.data.email.toLowerCase();
  const requestHeaders = await headers();
  const forwardedAddress = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  const clientAddress = (forwardedAddress || requestHeaders.get("x-real-ip") || "unknown").slice(
    0,
    80,
  );
  const rateLimitIdentity = `${clientAddress}\0${email}`;
  const rateLimit = await consumeRateLimit({
    namespace: "sign-in",
    identifier: rateLimitIdentity,
    maximum: 5,
    windowMinutes: 15,
    blockMinutes: 15,
  });
  if (!rateLimit.allowed) {
    return { error: "Too many sign-in attempts. Please try again later." };
  }
  if (email !== serverEnv().OWNER_EMAIL.toLowerCase()) {
    return { error: "The email or password is incorrect." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "The email or password is incorrect." };
  await clearRateLimit({ namespace: "sign-in", identifier: rateLimitIdentity });
  redirect("/");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
