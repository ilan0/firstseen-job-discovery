import "server-only";
import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { serverEnv } from "@/lib/env/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { rolloutFlags } from "@/config/rollout";
import { hasAccountAccess } from "@/lib/auth/account-access";

export async function currentOwner(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  if (!rolloutFlags().individualAuth) {
    if (data.user.email?.toLowerCase() !== serverEnv().OWNER_EMAIL.toLowerCase()) return null;
  } else if (!(await hasAccountAccess(data.user))) return null;
  return data.user;
}

export async function requireOwner(): Promise<User> {
  const owner = await currentOwner();
  if (!owner) redirect("/sign-in");
  return owner;
}
