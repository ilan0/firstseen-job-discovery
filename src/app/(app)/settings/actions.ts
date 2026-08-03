"use server";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { searchPreferences } from "@/db/schema";
import { requireOwner } from "@/lib/auth/owner";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
const schema = z.object({
  digestEnabled: z.enum(["on"]).optional(),
  alertsEnabled: z.enum(["on"]).optional(),
  digestHour: z.coerce.number().int().min(0).max(23),
});
export async function updateNotifications(formData: FormData) {
  const owner = await requireOwner();
  const value = schema.parse({
    digestEnabled: formData.get("digestEnabled") ?? undefined,
    alertsEnabled: formData.get("alertsEnabled") ?? undefined,
    digestHour: formData.get("digestHour"),
  });
  await db
    .update(searchPreferences)
    .set({
      digestEnabled: Boolean(value.digestEnabled),
      exceptionalAlertsEnabled: Boolean(value.alertsEnabled),
      digestHourLocal: value.digestHour,
      preferencesVersion: sql`${searchPreferences.preferencesVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(searchPreferences.userId, owner.id));
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export async function deleteAccount(formData: FormData) {
  const owner = await requireOwner();
  z.literal("DELETE FIRSTSEEN").parse(formData.get("confirmation"));
  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.deleteUser(owner.id);
  if (error) throw new Error("Account deletion failed. No data was intentionally removed.");
  const session = await createSupabaseServerClient();
  await session.auth.signOut();
  redirect("/sign-in?deleted=1");
}
