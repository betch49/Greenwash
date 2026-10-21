import type { LLMClient, LLMRequest, LLMResponse } from "@/lib/llm/client";

/** A scripted LLM: answers each call with `answer(req)`; records the requests. */
export class FakeLLM implements LLMClient {
  readonly kind = "mock" as const;
  readonly unavailable: string | null = null;
  readonly requests: LLMRequest[] = [];
  constructor(private readonly answer: (req: LLMRequest) => unknown | Promise<unknown>) {}
  async call(req: LLMRequest): Promise<LLMResponse> {
    this.requests.push(req);
    return { output: await this.answer(req), used_fixture: false };
  }
}
