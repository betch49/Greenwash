// PLAN criterion 7.7: no key ⇒ MockLLM; key + GR_OFFLINE_FIXTURES=1 ⇒ MockLLM; key only ⇒ AnthropicLLM (constructor only, no network).
import { describe, expect, it } from "vitest";
import { AnthropicLLM, toolName } from "@/lib/llm/anthropic";
import { LLMError, SYSTEM_PROMPT } from "@/lib/llm/client";
import { LLM_CONFIG, modelId } from "@/lib/llm/config";
import { ExtractOutputSchema } from "@/lib/llm/extract";
import { MockLLM } from "@/lib/llm/mock";
import { selectLLM } from "@/lib/llm/select";
import { findForbidden } from "@/lib/copy/forbidden";

const req = { name: "extract" as const, instructions: "Task: x.", input: { b: 1, a: "text" }, schema: ExtractOutputSchema };

describe("LLM client selection (7.7)", () => {
  it("no key ⇒ MockLLM, marked unavailable (no API key)", () => {
    const c = selectLLM({});
    expect(c).toBeInstanceOf(MockLLM);
    expect(c.unavailable).toBe("no API key");
  });

  it("key + GR_OFFLINE_FIXTURES=1 ⇒ MockLLM over fixtures/llm, available", () => {
    const c = selectLLM({ ANTHROPIC_API_KEY: "sk-test", GR_OFFLINE_FIXTURES: "1" }, "/repo");
    expect(c).toBeInstanceOf(MockLLM);
    expect(c.unavailable).toBeNull();
    expect((c as MockLLM).dir).toBe("/repo/fixtures/llm");
    expect(selectLLM({ GR_OFFLINE_FIXTURES: "1" })).toBeInstanceOf(MockLLM);
  });

  it("key only ⇒ AnthropicLLM; the model id comes from config/llm.json or GR_LLM_MODEL", () => {
    const c = selectLLM({ ANTHROPIC_API_KEY: "sk-test" });
    expect(c).toBeInstanceOf(AnthropicLLM);
    expect((c as AnthropicLLM).model).toBe(modelId(process.env));
    expect(modelId({})).toBe(LLM_CONFIG.model);
    expect(modelId({ GR_LLM_MODEL: "claude-haiku-5-5" })).toBe("claude-haiku-5-5");
  });
});

describe("AnthropicLLM request (no network)", () => {
  it("one strict tool from the zod schema (additionalProperties false), automatic tool choice, the shared system prompt", () => {
    const p = new AnthropicLLM({ apiKey: "sk-test", model: "claude-sonnet-5-5" }).params(req);
    expect(p.model).toBe("claude-sonnet-5-5");
    expect(p.tools).toHaveLength(1);
    const tool = p.tools![0] as { name: string; strict: boolean; input_schema: Record<string, unknown> };
    expect(tool.name).toBe(toolName("extract"));
    expect(tool.strict).toBe(true);
    expect(tool.input_schema).toMatchObject({ type: "object", additionalProperties: false, required: ["claims"] });
    expect(JSON.stringify(tool.input_schema)).not.toContain("$schema");
    expect(p.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
    expect(p.system).toBe(`${SYSTEM_PROMPT}\n\nTask: x.`);
    expect(JSON.stringify(p.messages)).toContain('{\\"a\\":\\"text\\",\\"b\\":1}');
  });

  it("temperature 0 is sent to models that accept it; current models that reject sampling parameters get none (CHALLENGES C-5)", () => {
    expect(new AnthropicLLM({ apiKey: "k", model: "claude-sonnet-5-5" }).params(req)).not.toHaveProperty("temperature");
    expect(new AnthropicLLM({ apiKey: "k", model: "claude-haiku-4-5" }).params(req).temperature).toBe(0);
  });

  it("returns the tool input; a refusal or an API error is an LLMError", async () => {
    const sdk = (res: unknown) => ({ beta: { messages: { create: async () => res } } }) as never;
    const ok = new AnthropicLLM({ apiKey: "k", sdk: sdk({ stop_reason: "tool_use", content: [{ type: "tool_use", name: toolName("extract"), id: "t", input: { claims: [] } }] }) });
    expect(await ok.call(req)).toEqual({ output: { claims: [] }, used_fixture: false });
    const none = new AnthropicLLM({ apiKey: "k", sdk: sdk({ stop_reason: "end_turn", content: [{ type: "text", text: "hi" }] }) });
    expect(await none.call(req)).toEqual({ output: undefined, used_fixture: false });
    const refused = new AnthropicLLM({ apiKey: "k", sdk: sdk({ stop_reason: "refusal", content: [] }) });
    await expect(refused.call(req)).rejects.toBeInstanceOf(LLMError);
    const failing = new AnthropicLLM({ apiKey: "k", sdk: { beta: { messages: { create: async () => Promise.reject(new Error("ECONNRESET")) } } } as never });
    await expect(failing.call(req)).rejects.toThrow("ECONNRESET");
  });

  it("the system prompt forbids outside sources and passes the wording filter", () => {
    expect(SYSTEM_PROMPT).toMatch(/Use only the text inside <input>/);
    expect(SYSTEM_PROMPT).toMatch(/never reference, invent or guess a source/);
    expect(findForbidden(SYSTEM_PROMPT)).toEqual([]);
  });
});
