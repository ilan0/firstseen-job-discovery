import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { notificationReads, notifications } from "@/db/schema";
import { currentOwner } from "@/lib/auth/owner";
import { serverEnv } from "@/lib/env/server";
import { hasTrustedMutationOrigin } from "@/lib/security/request-origin";

const bodySchema = z.object({ notificationId: z.string().uuid() });

export async function POST(request: Request) {
  const owner = await currentOwner();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasTrustedMutationOrigin(request, serverEnv().NEXT_PUBLIC_APP_URL))
    return NextResponse.json({ error: "Untrusted request origin" }, { status: 403 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid notification" }, { status: 400 });
  const [notification] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(eq(notifications.id, parsed.data.notificationId), eq(notifications.userId, owner.id)),
    )
    .limit(1);
  if (!notification) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db
    .insert(notificationReads)
    .values({ userId: owner.id, logicalNotificationId: notification.id })
    .onConflictDoNothing();
  const [unread] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, owner.id),
        sql`not exists (
          select 1 from ${notificationReads}
          where ${notificationReads.userId} = ${owner.id}
            and ${notificationReads.logicalNotificationId} = ${notifications.id}
        )`,
      ),
    );
  return NextResponse.json({ unreadCount: Number(unread?.count ?? 0) });
}
