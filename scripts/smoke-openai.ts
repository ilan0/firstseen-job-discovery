import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { parse } from "dotenv";
import { buildJobAnalysisInput, JOB_ANALYSIS_SYSTEM_PROMPT } from "@/ai/prompt";
import { jobAnalysisSchema } from "@/ai/schema";
import { validateEvidenceOffsets } from "@/ai/validate";

const values = parse(readFileSync(resolve(".env.local"), "utf8"));
const key = values.OPENAI_API_KEY;
const model = values.OPENAI_MODEL;
if (!key || !model) throw new Error("OpenAI smoke configuration is missing");
const client = new OpenAI({ apiKey: key, timeout: 30_000 });
try {
  const description =
    "This is a full-time hybrid Software Engineer role in Miami, Florida. Candidates must have 0-1 years of experience. TypeScript is required. No security clearance or Public Trust is required.";
  const response = await client.responses.parse({
    model,
    input: [
      { role: "system", content: JOB_ANALYSIS_SYSTEM_PROMPT },
      {
        role: "user",
        content: buildJobAnalysisInput({
          title: "Software Engineer",
          employmentType: "Full-time",
          locations: ["Miami, FL"],
          workplaceType: "Hybrid",
          description,
        }),
      },
    ],
    text: { format: zodTextFormat(jobAnalysisSchema, "job_analysis") },
  });
  if (!response.output_parsed) throw new Error("Parsed output missing");
  validateEvidenceOffsets(response.output_parsed, description);
  console.log(
    JSON.stringify({
      ok: true,
      model,
      responseIdPresent: Boolean(response.id),
      evidenceValid: true,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    }),
  );
} catch (error) {
  const value = error as { status?: number; code?: string; name?: string };
  console.error(
    JSON.stringify({
      ok: false,
      model,
      status: value.status ?? null,
      code: value.code ?? value.name ?? "UNKNOWN",
    }),
  );
  process.exitCode = 1;
}
