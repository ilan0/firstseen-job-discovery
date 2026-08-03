import { z } from "zod";

export const AI_ANALYSIS_SCHEMA_VERSION = "2026-08-03.1";

const confidenceSchema = z.enum(["low", "medium", "high"]);

const evidenceSchema = z.object({
  field: z.string().min(1).max(80),
  quote: z.string().min(1).max(500),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
});

const requirementSchema = z.object({
  text: z.string().min(1).max(600),
  kind: z.enum(["required", "preferred"]),
  minimumYears: z.number().min(0).max(50).nullable(),
  maximumYears: z.number().min(0).max(50).nullable(),
  alternativePath: z.boolean(),
  confidence: confidenceSchema,
  evidence: z.array(evidenceSchema).max(5),
});

const extractedFactSchema = <T extends z.ZodType>(value: T) =>
  z.object({
    value,
    confidence: confidenceSchema,
    evidence: z.array(evidenceSchema).max(8),
  });

export const jobAnalysisSchema = z.object({
  employment: extractedFactSchema(
    z.enum(["full_time", "part_time", "contract", "internship", "temporary", "unknown"]),
  ),
  experienceRequirements: z.array(requirementSchema).max(20),
  clearance: extractedFactSchema(
    z.enum(["required", "not_required", "not_mentioned", "uncertain"]),
  ),
  publicTrust: extractedFactSchema(
    z.enum(["required", "not_required", "not_mentioned", "uncertain"]),
  ),
  sponsorship: extractedFactSchema(
    z.enum(["compatible", "incompatible", "not_mentioned", "uncertain"]),
  ),
  workArrangement: extractedFactSchema(z.enum(["onsite", "hybrid", "fully_remote", "unknown"])),
  locations: extractedFactSchema(z.array(z.string().min(1).max(160)).max(20)),
  roleFamily: extractedFactSchema(
    z.enum([
      "general_swe",
      "full_stack",
      "backend",
      "frontend",
      "ai_engineering",
      "embedded",
      "internal_automation",
      "customer_facing",
      "other",
    ]),
  ),
  requiredSkills: z.array(z.string().min(1).max(100)).max(40),
  preferredSkills: z.array(z.string().min(1).max(100)).max(40),
  candidateStrengths: z.array(z.string().min(1).max(300)).max(8),
  candidateWeaknesses: z.array(z.string().min(1).max(300)).max(8),
  summary: z.string().min(1).max(1200),
  extractionWarnings: z.array(z.string().min(1).max(300)).max(10),
});

export type JobAnalysis = z.infer<typeof jobAnalysisSchema>;
export type AnalysisEvidence = z.infer<typeof evidenceSchema>;
