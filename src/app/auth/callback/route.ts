import { NextResponse } from "next/server";
import { rolloutFlags } from "@/config/rollout";
import { hasAccountAccess } from "@/lib/auth/account-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeAppPath } from "@/lib/security/app-path";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requestedPath = url.searchParams.get("next");
  const next = safeAppPath(requestedPath) ?? "/";
  if (!code) return NextResponse.redirect(new URL("/sign-in?error=expired", url.origin));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/sign-in?error=expired", url.origin));
  if (rolloutFlags().individualAuth) {
    const authenticated = await supabase.auth.getUser();
    if (!authenticated.data.user || !(await hasAccountAccess(authenticated.data.user))) {
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL("/sign-in?error=unauthorized", url.origin));
    }
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
