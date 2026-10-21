import type { Axis, Signal } from "@/lib/pipeline/signal";
import type { ScoreInput } from "@/lib/score/scorer";
import { AXES, WEIGHTS } from "@/lib/score/weights";

/** Deterministic PRNG (mulberry32) so a failing property case can be replayed from its seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOSTS = ["https://www.example.com/a", "https://brand.example/b", "https://www.asa.org.uk/rulings/x.html", "https://web.archive.org/web/2021id_/https://brand.example/c"];
const EXTRA_KINDS = ["unknown.kind"];

let counter = 0;
export function signal(over: Partial<Signal> & { axis: Axis; kind: string }): Signal {
  counter++;
  return {
    id: `s${counter}`,
    label: `label ${counter}`,
    weight_hint: 1,
    source_url: "https://brand.example/page",
    fetched_at: "2026-10-20T12:00:00Z",
    excerpt: "An excerpt.",
    llm_used: false,
    ...over,
  };
}

export type LlmMode = "mixed" | "all" | "none";

/** A random signal set over every configured kind (plus an unknown one), random hints, hosts and LLM flags. */
export function randomSignals(r: () => number, llm: LlmMode = "mixed", max = 40): Signal[] {
  const n = Math.floor(r() * (max + 1));
  const out: Signal[] = [];
  for (let i = 0; i < n; i++) {
    const axis = AXES[Math.floor(r() * AXES.length)];
    const kinds = [...Object.keys(WEIGHTS.points[axis]), ...EXTRA_KINDS];
    const kind = kinds[Math.floor(r() * kinds.length)];
    const llm_used = llm === "all" ? true : llm === "none" ? false : r() < 0.5;
    out.push(signal({ axis, kind, llm_used, weight_hint: r() < 0.2 ? r() * 4 : 1, source_url: HOSTS[Math.floor(r() * HOSTS.length)] }));
  }
  return out;
}

const STEP_IDS = ["claims", "evidence", "wayback", "asa-uk", "jdp-fr", "repair"];

export function randomInput(r: () => number, llm: LlmMode = "mixed"): ScoreInput {
  const step_status: ScoreInput["step_status"] = {};
  for (const id of STEP_IDS) step_status[id] = r() < 0.75 ? "done" : "skipped";
  return {
    signals: randomSignals(r, llm),
    words_scanned: Math.floor(r() * 20000),
    repair_axis: r() < 0.25 ? "not_applicable" : "applicable",
    step_status,
    archived_snapshots: Math.floor(r() * 4),
    // An all-LLM set has no rule-based input at all, so no ClaimStats either.
    claim_stats: llm !== "all" && r() < 0.3 ? { matches: Math.floor(r() * 50), unsupported: Math.floor(r() * 30), wordCount: Math.floor(r() * 20000) } : undefined,
  };
}

export const ALL_DONE: ScoreInput["step_status"] = Object.fromEntries(STEP_IDS.map((id) => [id, "done"]));
