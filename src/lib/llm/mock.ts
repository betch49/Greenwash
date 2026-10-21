// MockLLM (PLAN Phase 7 deliverable 2, ADR-006): recorded JSON fixtures at
// fixtures/llm/<name>-<sha1(input).slice(0,12)>.json. A call with no fixture
// returns no output (each task turns that into its empty valid result) and
// never throws. With a recorder (GR_RECORD_LLM=1 and a real key), a missing
// fixture is fetched from the real client and written to disk.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixtureFileName, inputHash, type LLMClient, type LLMRequest, type LLMResponse } from "./client";

/** What a fixture file holds. `source` says whether a model produced it or a person wrote it. */
export interface LLMFixture {
  name: string;
  input_sha1: string;
  source: string;
  output: unknown;
}

export interface MockOptions {
  /** Real client used on a missing fixture; its answer is written as a new fixture. */
  recorder?: LLMClient;
  /** When set, the steps that use the LLM are skipped with this reason (no key outside offline mode). */
  unavailable?: string | null;
}

export class MockLLM implements LLMClient {
  readonly kind = "mock" as const;
  readonly unavailable: string | null;
  /** Fixture files that were requested but missing (useful when authoring fixtures). */
  readonly missing: string[] = [];

  constructor(
    readonly dir: string,
    private readonly opts: MockOptions = {},
  ) {
    this.unavailable = opts.unavailable ?? null;
  }

  pathFor(req: Pick<LLMRequest, "name" | "input">): string {
    return join(this.dir, fixtureFileName(req.name, req.input));
  }

  async call(req: LLMRequest): Promise<LLMResponse> {
    const path = this.pathFor(req);
    if (existsSync(path)) {
      try {
        const fx = JSON.parse(readFileSync(path, "utf8")) as Partial<LLMFixture>;
        return { output: fx.output, used_fixture: true };
      } catch {
        // A corrupt fixture is an invalid payload for the task to reject, not a crash.
        return { output: null, used_fixture: true };
      }
    }
    if (this.opts.recorder) {
      const res = await this.opts.recorder.call(req);
      mkdirSync(this.dir, { recursive: true });
      const fx: LLMFixture = { name: req.name, input_sha1: inputHash(req.input), source: `recorded with ${this.opts.recorder.kind} (GR_RECORD_LLM=1)`, output: res.output };
      writeFileSync(path, `${JSON.stringify(fx, null, 2)}\n`);
      return { output: res.output, used_fixture: false };
    }
    this.missing.push(path);
    return { output: undefined, used_fixture: false };
  }
}
