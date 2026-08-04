import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import { analyzeJob, evaluationGates, ROUTINE_EXTRACTION_MODEL, scoreAiEvaluation } from "@/ai";

dotenv.config({ path: ".env.local", quiet: true });

const experienceSchema = z.object({
  kind: z.enum(["required", "preferred"]),
  minimumYears: z.number().nonnegative().nullable(),
  maximumYears: z.number().nonnegative().nullable(),
});
const corpusSchema = z
  .array(
    z.object({
      id: z.string().min(1).max(160),
      job: z.object({
        title: z.string().min(1).max(500),
        description: z.string().min(1).max(60_000),
        employmentType: z.string().max(160).nullable().optional(),
        locations: z.array(z.string().max(500)).max(50).optional(),
        workplaceType: z.string().max(160).nullable().optional(),
      }),
      expected: z.object({
        hardOutcome: z.enum(["eligible", "ineligible", "review"]),
        experienceKinds: z.array(experienceSchema).max(30),
      }),
    }),
  )
  .min(300)
  .max(2_000);

const path = process.argv[2];
if (!path) throw new Error("Usage: pnpm eval:corpus <eval-corpus/corpus.json>");
const corpus = corpusSchema.parse(JSON.parse(readFileSync(resolve(path), "utf8")));
const scored = [];
const latencies: number[] = [];
let estimatedCostUsd = 0;
for (const item of corpus) {
  const result = await analyzeJob(
    {
      title: item.job.title,
      description: item.job.description,
      employmentType: item.job.employmentType ?? null,
      locations: item.job.locations ?? [],
      workplaceType: item.job.workplaceType ?? null,
    },
    { model: ROUTINE_EXTRACTION_MODEL },
  );
  scored.push({ expected: item.expected, analysis: result.analysis, evidenceValid: true });
  latencies.push(result.latencyMs);
  estimatedCostUsd += result.estimatedCostUsd;
}
latencies.sort((left, right) => left - right);
const metrics = scoreAiEvaluation(scored);
const gates = evaluationGates(metrics);
console.log(
  JSON.stringify({
    ok: Object.values(gates).every(Boolean),
    model: ROUTINE_EXTRACTION_MODEL,
    metrics,
    gates,
    p95LatencyMs: latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? null,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
    descriptionsRetainedByFirstSeen: false,
  }),
);
if (!Object.values(gates).every(Boolean)) process.exitCode = 1;
