// The only reader of config/llm.json (PLAN Phase 7 deliverable 1).
import { z } from "zod";
import raw from "../../../config/llm.json";

export const LlmConfigSchema = z.object({
  version: z.literal(1),
  model: z.string().min(1),
  maxTokens: z.number().int().positive(),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
  temperature: z.number().min(0).max(1),
  temperatureModels: z.array(z.string()),
  fallbacks: z.union([z.literal("default"), z.literal("none")]),
  fallbackBeta: z.string().min(1),
  timeoutMs: z.number().int().positive(),
  fixturesDir: z.string().min(1),
  extract: z.object({ maxPages: z.number().int().min(0), maxChars: z.number().int().positive(), maxClaims: z.number().int().positive() }),
  classify: z.object({ maxCandidates: z.number().int().min(0) }),
  summary: z.object({ maxWords: z.number().int().positive() }),
});

export type LlmConfig = z.infer<typeof LlmConfigSchema>;

export const LLM_CONFIG: LlmConfig = LlmConfigSchema.parse(raw);

/** The model id: GR_LLM_MODEL when set, else config/llm.json. */
export const modelId = (env: Record<string, string | undefined> = process.env, config: LlmConfig = LLM_CONFIG) => env.GR_LLM_MODEL?.trim() || config.model;
