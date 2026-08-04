"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { verifyAccessCode } from "@/lib/auth/access-code";
import { isInvitedEmail } from "@/lib/auth/account-access";
import { serverEnv } from "@/lib/env/server";
import { clearRateLimit, consumeRateLimit } from "@/lib/security/rate-limit";
import { safeAppPath } from "@/lib/security/app-path";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SignInState = { error?: string };

const safeNext = z
  .string()
  .max(2_000)
  .refine((value) => safeAppPath(value) !== null)
  .transform((value) => safeAppPath(value)!);
const credentialsSchema = z.object({
  code: z.string().regex(/^\d{4}$/),
  next: safeNext.default("/"),
});

export async function signIn(_: SignInState, formData: FormData): Promise<SignInState> {
  if (process.env.OWNER_CODE_AUTH_ENABLED === "false")
    return { error: "Owner code access is disabled." };
  const parsed = credentialsSchema.safeParse({
    code: formData.get("code"),
    next: formData.get("next") || "/",
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
  redirect(parsed.data.next);
}

const emailSchema = z.object({ email: z.email().max(320), next: safeNext.default("/") });

export async function requestEmailSignIn(
  _: SignInState,
  formData: FormData,
): Promise<SignInState & { success?: string }> {
  if (process.env.INDIVIDUAL_AUTH_ENABLED !== "true")
    return { error: "Individual email access is not enabled." };
  const parsed = emailSchema.safeParse({
    email: formData.get("email"),
    next: formData.get("next") || "/",
  });
  if (!parsed.success) return { error: "Enter a valid invited email address." };
  const rate = await consumeRateLimit({
    namespace: "email-otp",
    identifier: parsed.data.email.toLowerCase(),
    maximum: 3,
    windowMinutes: 60,
    blockMinutes: 60,
  });
  if (!rate.allowed) return { error: "Too many email-link requests. Try again later." };
  if (!(await isInvitedEmail(parsed.data.email)))
    return { error: "This address is not invited or email delivery is unavailable." };
  const supabase = await createSupabaseServerClient();
  const appUrl = new URL(serverEnv().NEXT_PUBLIC_APP_URL);
  appUrl.pathname = "/auth/callback";
  appUrl.searchParams.set("next", parsed.data.next);
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email.toLowerCase(),
    options: { shouldCreateUser: false, emailRedirectTo: appUrl.toString() },
  });
  if (error) return { error: "This address is not invited or email delivery is unavailable." };
  return { success: "Check your email for a secure FirstSeen sign-in link." };
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
