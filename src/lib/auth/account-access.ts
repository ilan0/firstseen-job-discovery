import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { accountAccess } from "@/db/schema";

export async function hasAccountAccess(user: { id: string; email?: string | null }) {
  if (!user.email) return false;
  const [access] = await db
    .select({ id: accountAccess.id })
    .from(accountAccess)
    .where(
      and(
        eq(accountAccess.userId, user.id),
        eq(accountAccess.email, user.email.toLowerCase()),
        inArray(accountAccess.status, ["invited", "active"]),
      ),
    )
    .limit(1);
  return Boolean(access);
}

export async function isInvitedEmail(email: string) {
  const [access] = await db
    .select({ id: accountAccess.id })
    .from(accountAccess)
    .where(
      and(
        eq(accountAccess.email, email.toLowerCase()),
        inArray(accountAccess.status, ["invited", "active"]),
      ),
    )
    .limit(1);
  return Boolean(access);
}
