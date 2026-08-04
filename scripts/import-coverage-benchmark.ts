import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import { coverageUrlHash } from "@/lib/coverage/identity";

dotenv.config({ path: ".env.local", quiet: true });

const itemSchema = z.object({
  cohort: z.string().min(1).max(120),
  sourceFamily: z.string().min(1).max(80),
  officialUrl: z.url().refine((value) => new URL(value).protocol === "https:"),
  independentlyObservedAt: z.iso.datetime(),
  eligibilityLabel: z.enum(["eligible", "ineligible", "review"]),
  benchmarkVersion: z.string().min(1).max(80),
  labelEvidence: z.record(z.string(), z.unknown()).optional(),
});
const inputSchema = z.array(itemSchema).min(1).max(5_000);
const path = process.argv[2];
if (!path) throw new Error("Usage: pnpm coverage:import <benchmark.json>");
const input = inputSchema.parse(JSON.parse(readFileSync(resolve(path), "utf8")));
const [{ db }, { coverageBenchmarks }] = await Promise.all([
  import("@/db/client"),
  import("@/db/schema"),
]);

let imported = 0;
for (const item of input) {
  const saved = await db
    .insert(coverageBenchmarks)
    .values({
      cohort: item.cohort,
      sourceFamily: item.sourceFamily,
      expectedOfficialUrlHash: coverageUrlHash(item.officialUrl),
      independentObservedAt: new Date(item.independentlyObservedAt),
      eligibilityLabel: item.eligibilityLabel,
      benchmarkVersion: item.benchmarkVersion,
      labelEvidence: item.labelEvidence ?? {},
    })
    .onConflictDoNothing()
    .returning({ id: coverageBenchmarks.id });
  imported += saved.length;
}

console.log(JSON.stringify({ ok: true, supplied: input.length, imported, rawUrlsRetained: false }));
