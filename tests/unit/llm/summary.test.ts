// PLAN criterion 7.4: a summary citing a URL that was not fetched is rejected; fetched URLs only pass; forbidden words are rejected.
import { describe, expect, it } from "vitest";
import { checkSummary, summarise } from "@/lib/llm/summary";
import type { ReportV1 } from "@/lib/score/report";
import { FakeLLM } from "./fake";

const FETCHED = ["https://a.example/impact", "https://web.archive.org/web/20210315141503id_/https://a.example/impact"];
const report = {
  version: 1, run_id: "r", brand: "A", website: "https://a.example", score: 30, label: "moderate", label_text: "Moderate signals", confidence: 70, ai_share: 0.2, llm_signal_ids: [], basis: "Based on 2 verified signals from 2 sources.",
  axes: [
    { id: "claims", weight: 0.25, effective_weight: 0.25, status: "scored", subscore: 40, signals: [{ id: "c", axis: "claims", kind: "claim.unsupported", label: "Unsupported claim", weight_hint: 1, source_url: FETCHED[0], fetched_at: "2026-10-20T00:00:00Z", excerpt: "We are green.", llm_used: false }] },
    { id: "evidence", weight: 0.25, effective_weight: 0.25, status: "missing", subscore: 0, signals: [] },
    { id: "track", weight: 0.3, effective_weight: 0.3, status: "scored", subscore: 20, signals: [{ id: "t", axis: "track", kind: "claim.removed", label: "Claim removed", weight_hint: 1, source_url: FETCHED[1], fetched_at: "2026-10-20T00:00:00Z", excerpt: "We are carbon neutral.", snapshot_date: "2021-03-15", llm_used: true }] },
    { id: "repair", weight: 0.2, effective_weight: 0.2, status: "missing", subscore: 0, signals: [] },
  ],
  timeline: [], could_not_check: ["x"], skipped: [], generated_at: "2026-10-20T00:00:00Z", sources_count: 2, signals_count: 2, llm_calls: [],
} as ReportV1;

describe("summary (7.4)", () => {
  it("a URL in the text that was not fetched ⇒ rejected", () => {
    const r = checkSummary({ summary: "See https://other.example/page for details.", cited_urls: [] }, FETCHED);
    expect(r).toEqual({ ok: false, reason: "cites a URL that was not fetched (https://other.example/page)" });
  });

  it("a cited_urls entry that was not fetched ⇒ rejected, even if the text names none", () => {
    expect(checkSummary({ summary: "One unsupported claim.", cited_urls: ["https://a.example/other"] }, FETCHED).ok).toBe(false);
  });

  it("only fetched URLs ⇒ passes", () => {
    const r = checkSummary({ summary: `One unsupported claim (${FETCHED[0]}). A claim removed between 2021 and 2024 (${FETCHED[1]}).`, cited_urls: FETCHED }, FETCHED);
    expect(r.ok).toBe(true);
  });

  it("a forbidden word ⇒ rejected", () => {
    for (const bad of ["The brand is lying about its footprint.", "This is greenwashing.", "The claims are deceptive."]) {
      const r = checkSummary({ summary: bad, cited_urls: [] }, FETCHED);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/wording filter/);
    }
  });

  it("more than 120 words ⇒ rejected", () => {
    expect(checkSummary({ summary: Array.from({ length: 121 }, () => "word").join(" "), cited_urls: [] }, FETCHED).ok).toBe(false);
    expect(checkSummary({ summary: Array.from({ length: 120 }, () => "word").join(" "), cited_urls: [] }, FETCHED).ok).toBe(true);
  });

  it("summarise: the allowed list is the fetched URLs (pages, receipts, archived copies); a rejected summary is a problem, not a throw", async () => {
    const llm = new FakeLLM(() => ({ summary: "See https://invented.example/.", cited_urls: [] }));
    const out = await summarise(llm, report, ["https://a.example/"]);
    expect(out.summary).toBeUndefined();
    expect(out.problem).toMatch(/not fetched/);
    expect((llm.requests[0].input as { allowed_urls: string[] }).allowed_urls).toEqual(["https://a.example/", ...FETCHED].sort());
    // Run-specific values are not part of the input (stable fixture key).
    expect(JSON.stringify(llm.requests[0].input)).not.toMatch(/generated_at|run_id|fetched_at/);
    const ok = await summarise(new FakeLLM(() => ({ summary: `Two risk signals, one from ${FETCHED[0]}.`, cited_urls: [FETCHED[0]] })), report, []);
    expect(ok.summary).toEqual({ text: `Two risk signals, one from ${FETCHED[0]}.`, cited_urls: [FETCHED[0]] });
  });
});
