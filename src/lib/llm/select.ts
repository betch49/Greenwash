// Which LLM client a process uses (PLAN Phase 7 deliverable 1, criterion 7.7).
//   GR_OFFLINE_FIXTURES=1          ⇒ MockLLM over fixtures/llm (with GR_RECORD_LLM=1 and a key: records missing fixtures)
//   ANTHROPIC_API_KEY set          ⇒ AnthropicLLM
//   neither                        ⇒ MockLLM marked unavailable: the LLM steps show "skipped: LLM unavailable (no API key)"

import { join } from "node:path";
import type { LLMClient } from "./client";
import { AnthropicLLM } from "./anthropic";
import { LLM_CONFIG } from "./config";
import { MockLLM } from "./mock";
import { reasons } from "../copy/wording";

export function selectLLM(env: Record<string, string | undefined> = process.env, root: string = process.cwd()): LLMClient {
  const key = env.ANTHROPIC_API_KEY?.trim();
  const dir = env.GR_LLM_FIXTURES_DIR || join(root, LLM_CONFIG.fixturesDir);
  if (env.GR_OFFLINE_FIXTURES === "1") {
    const recorder = key && env.GR_RECORD_LLM === "1" ? new AnthropicLLM({ apiKey: key }) : undefined;
    return new MockLLM(dir, { recorder });
  }
  if (key) return new AnthropicLLM({ apiKey: key });
  return new MockLLM(dir, { unavailable: reasons.noApiKey });
}
