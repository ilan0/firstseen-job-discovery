"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { verifyAccessCode } from "@/lib/auth/access-code";
import { serverEnv } from "@/lib/env/server";
import { clearRateLimit, consumeRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SignInState = { error?: string };

const credentialsSchema = z.object({ code: z.string().regex(/^\d{4}$/) });

export async function signIn(_: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = credentialsSchema.safeParse({
    code: formData.get("code"),
  });
  const requestHeaders = await headers();
  const forwardedAddress = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  const clientAddress = (forwardedAddress || requestHeaders.get("x-real-ip") || "unknown").slice(
    0,
    80,
  );
  const addressRateLimit = await consumeRateLimit({
    namespace: "access-code-address",
    identifier: clientAddress,
    maximum: 5,
    windowMinutes: 15,
    blockMinutes: 60,
  });
  const globalRateLimit = await consumeRateLimit({
    namespace: "access-code-global",
    identifier: "owner",
    maximum: 10,
    windowMinutes: 15,
    blockMinutes: 60,
  });
  if (!addressRateLimit.allowed || !globalRateLimit.allowed)
    return { error: "Too many attempts. Try again in about an hour." };
  if (!parsed.success) return { error: "Enter all four digits." };
  if (!(await verifyAccessCode(parsed.data.code, serverEnv().ACCESS_CODE_HASH)))
    return { error: "That code isn't right. Try again." };

  const email = serverEnv().OWNER_EMAIL.toLowerCase();
  const admin = createSupabaseAdminClient();
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const supabase = await createSupabaseServerClient();
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash || link?.user.email?.toLowerCase() !== email)
    return { error: "Sign-in is temporarily unavailable. Try again shortly." };
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (error) return { error: "Sign-in is temporarily unavailable. Try again shortly." };
  await Promise.all([
    clearRateLimit({ namespace: "access-code-address", identifier: clientAddress }),
    clearRateLimit({ namespace: "access-code-global", identifier: "owner" }),
  ]);
  redirect("/");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
