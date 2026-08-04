import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { serverEnv } from "@/lib/env/server";
import { estimateOpenAICost, type TokenUsage } from "./cost";
import {
  buildJobAnalysisInput,
  JOB_ANALYSIS_SYSTEM_PROMPT,
  jobAnalysisPromptHash,
  type JobAnalysisInput,
} from "./prompt";
import { AI_ANALYSIS_SCHEMA_VERSION, jobAnalysisSchema, type JobAnalysis } from "./schema";
import { validateEvidenceOffsets } from "./validate";

export type AnalysisResult = {
  analysis: JobAnalysis;
  model: string;
  schemaVersion: string;
  promptHash: string;
  usage: TokenUsage;
  estimatedCostUsd: number;
  latencyMs: number;
  responseId: string;
};

export type AnalyzeJobOptions = {
  model?: string;
  client?: OpenAI;
  validationAttempts?: 1 | 2;
  clientRequestId?: string;
};

export async function analyzeJob(
  job: JobAnalysisInput,
  options: AnalyzeJobOptions = {},
): Promise<AnalysisResult> {
  const env = options.model && options.client ? null : serverEnv();
  const model = options.model ?? env!.OPENAI_MODEL;
  const client = options.client ?? new OpenAI({ apiKey: env!.OPENAI_API_KEY, timeout: 30_000 });
  const startedAt = performance.now();
  const usage: TokenUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  let validationAttempt = 0;
  const execute = async () => {
    validationAttempt += 1;
    const response = await client.responses.parse(
      {
        model,
        input: [
          { role: "system", content: JOB_ANALYSIS_SYSTEM_PROMPT },
          { role: "user", content: buildJobAnalysisInput(job) },
        ],
        text: { format: zodTextFormat(jobAnalysisSchema, "job_analysis") },
      },
      options.clientRequestId
        ? {
            headers: {
              "X-Client-Request-Id": `${options.clientRequestId}-validation-${validationAttempt}`,
            },
          }
        : undefined,
    );
    usage.inputTokens += response.usage?.input_tokens ?? 0;
    usage.cachedInputTokens += response.usage?.input_tokens_details?.cached_tokens ?? 0;
    usage.outputTokens += response.usage?.output_tokens ?? 0;
    if (!response.output_parsed)
      throw new Error("OpenAI response did not contain a parsed job analysis");
    return {
      response,
      analysis: validateEvidenceOffsets(response.output_parsed, job.description),
    };
  };
  let parsed: Awaited<ReturnType<typeof execute>>;
  try {
    parsed = await execute();
  } catch (firstError) {
    if ((options.validationAttempts ?? 2) === 1) throw firstError;
    parsed = await execute();
  }
  const { response, analysis } = parsed;

  return {
    analysis,
    model,
    schemaVersion: AI_ANALYSIS_SCHEMA_VERSION,
    promptHash: jobAnalysisPromptHash(),
    usage,
    estimatedCostUsd: estimateOpenAICost(model, usage),
    latencyMs: Math.round(performance.now() - startedAt),
    responseId: response.id,
  };
}
