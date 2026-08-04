import { NextResponse } from "next/server";
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
  return NextResponse.redirect(new URL(next, url.origin));
}
