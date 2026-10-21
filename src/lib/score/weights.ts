// The only reader of config/weights.json for scoring (PLAN Phase 6 deliverable 1).
// Every number the scorer uses comes from here; the schema rejects a file that
// could break the brief's rules (negative points, weights not summing to 1,
// an AI share cap above the brief's 50%).
import { z } from "zod";
import raw from "../../../config/weights.json";
import type { Axis } from "../pipeline/signal";

export const AXES = ["claims", "evidence", "track", "repair"] as const satisfies readonly Axis[];

/** Brief Section 4: AI may contribute at most half of a score. The config may be stricter, never looser. */
export const BRIEF_MAX_AI_SHARE = 0.5;
const WEIGHT_SUM_TOLERANCE = 1e-9;

const perAxis = <T extends z.ZodType>(t: T) => z.object({ claims: t, evidence: t, track: t, repair: t });
const points = z.record(z.string(), z.number().min(0));

export const WeightsSchema = z
  .object({
    version: z.literal(1),
    axes: perAxis(z.number().min(0).max(1)),
    points: perAxis(points),
    caps: perAxis(z.number().min(0).max(100)),
    claimsRate: z.object({ perWords: z.number().positive(), minWords: z.number().positive(), subscorePerPointPer1000Words: z.number().min(0) }),
    defaultWeightHint: z.number().min(0),
    regulatorRuling: z.object({ baseHint: z.number().min(0), upheldMultiplier: z.number().min(0), recentYears: z.number().min(0), recentMultiplier: z.number().min(0) }),
    llmGuard: z.object({ maxShare: z.number().min(0).max(BRIEF_MAX_AI_SHARE) }),
    /** Phase 7: an "unsure" diff classification keeps the removal with its weight_hint × this (≤ 1: the LLM can only lower it). */
    llm: z.object({ unsureWeightMultiplier: z.number().min(0).max(1) }),
    labels: z.object({ moderateFrom: z.number().min(0).max(100), highFrom: z.number().min(0).max(100) }),
    confidence: z.object({
      axisSteps: perAxis(z.array(z.string()).min(1)),
      timelineCountsAsData: z.array(z.enum(AXES)),
    }),
  })
  .refine((w) => Math.abs(AXES.reduce((a, k) => a + w.axes[k], 0) - 1) < WEIGHT_SUM_TOLERANCE, { message: "axis weights must sum to 1" })
  .refine((w) => w.labels.moderateFrom <= w.labels.highFrom, { message: "labels.moderateFrom must not exceed labels.highFrom" });

export type Weights = z.infer<typeof WeightsSchema>;

/** The validated weights file. */
export const WEIGHTS: Weights = WeightsSchema.parse(raw);
