import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { watchlists } from "@/db/schema";
import { adaptiveColdCadenceMinutes } from "@/domain/companies/monitoring";

export async function rebalanceColdCadence() {
  const active = await db.select().from(watchlists).where(eq(watchlists.active, true));
  const cold = active.filter(
    (watch) => watch.scope === "discovered" && watch.monitoringTier === "cold",
  );
  const protectedScansPerDay = active
    .filter((watch) => !cold.includes(watch))
    .reduce((total, watch) => total + 1_440 / watch.cadenceMinutes, 0);
  const cadenceMinutes = adaptiveColdCadenceMinutes({
    protectedScansPerDay,
    coldCompanyCount: cold.length,
  });
  if (cold.length)
    await db
      .update(watchlists)
      .set({ cadenceMinutes, updatedAt: new Date() })
      .where(
        and(
          eq(watchlists.active, true),
          eq(watchlists.scope, "discovered"),
          eq(watchlists.monitoringTier, "cold"),
          ne(watchlists.cadenceMinutes, cadenceMinutes),
        ),
      );
  return { protectedScansPerDay, coldCompanyCount: cold.length, cadenceMinutes };
}
