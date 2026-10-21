// The real LLM client (PLAN Phase 7 deliverable 1): the official Anthropic SDK,
// one strict tool whose input schema is the task's zod schema, the shared
// system prompt, model id from config/llm.json (or GR_LLM_MODEL).

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { LLMError, SYSTEM_PROMPT, stableStringify, type LLMClient, type LLMRequest, type LLMResponse } from "./client";
import { LLM_CONFIG, modelId, type LlmConfig } from "./config";

export interface AnthropicOptions {
  apiKey: string;
  model?: string;
  config?: LlmConfig;
  /** Injected SDK client (tests); built from apiKey otherwise. No request is made at construction. */
  sdk?: Pick<Anthropic, "beta">;
}

/** The tool's JSON schema: the zod schema without the `$schema` key (strict tool use needs additionalProperties: false, which z.strictObject gives). */
export function toolSchema(schema: z.ZodType): Anthropic.Beta.BetaTool.InputSchema {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json as Anthropic.Beta.BetaTool.InputSchema;
}

export const toolName = (name: string) => `record_${name.replace(/[^a-z0-9_]/gi, "_")}`;

export class AnthropicLLM implements LLMClient {
  readonly kind = "anthropic" as const;
  readonly unavailable = null;
  readonly model: string;
  private readonly config: LlmConfig;
  private readonly sdk: Pick<Anthropic, "beta">;

  constructor(opts: AnthropicOptions) {
    this.config = opts.config ?? LLM_CONFIG;
    this.model = opts.model ?? modelId(process.env, this.config);
    this.sdk = opts.sdk ?? new Anthropic({ apiKey: opts.apiKey, timeout: this.config.timeoutMs });
  }

  /** The request body for one call (exported for tests: no network). */
  params(req: LLMRequest): Anthropic.Beta.MessageCreateParamsNonStreaming {
    const tool = toolName(req.name);
    const sendTemperature = this.config.temperatureModels.includes(this.model);
    return {
      model: this.model,
      max_tokens: this.config.maxTokens,
      system: `${SYSTEM_PROMPT}\n\n${req.instructions}`,
      messages: [{ role: "user", content: `<input>\n${stableStringify(req.input)}\n</input>\n\nCall the ${tool} tool with your answer.` }],
      tools: [{ name: tool, description: `Records the ${req.name} result.`, strict: true, input_schema: toolSchema(req.schema) }],
      // Forced tool choice is rejected by current models; the prompt names the tool and the schema is strict.
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      output_config: { effort: this.config.effort },
      ...(sendTemperature ? { temperature: this.config.temperature } : {}),
      ...(this.config.fallbacks === "default" ? { fallbacks: "default" as const, betas: [this.config.fallbackBeta] } : {}),
    };
  }

  async call(req: LLMRequest): Promise<LLMResponse> {
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await this.sdk.beta.messages.create(this.params(req));
    } catch (err) {
      if (err instanceof Anthropic.APIError) throw new LLMError(`Anthropic API error ${err.status ?? ""}`.trim());
      throw new LLMError(err instanceof Error ? err.message : String(err));
    }
    if (res.stop_reason === "refusal") throw new LLMError("the model declined the request");
    const block = res.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === toolName(req.name));
    return { output: block?.input, used_fixture: false };
  }
}
