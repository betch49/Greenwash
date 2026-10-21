import { describe, expect, it } from "vitest";
import { findForbidden } from "@/lib/copy/forbidden";
import { displayStatus, fallbackSummary, stripStepPrefix } from "@/lib/report/display";
import { clearRecentRuns, createOnce } from "@/lib/run-dedupe";
import { resolveSite } from "@/lib/site-name";
import type { ReportV1 } from "@/lib/score/report";
import { capQuery, looksLikeUrl, siteNameFromHtml, truncate, withWww } from "@/lib/website";
import type { Fetcher } from "@/lib/fetch/fetcher";

const report = (over: Partial<ReportV1> = {}): ReportV1 =>
  ({
    version: 1,
    run_id: "r",
    brand: "Northwind",
    website: "https://www.northwind-outdoor.example",
    score: 34,
    label: "moderate",
    label_text: "Moderate signals",
    confidence: 80,
    ai_share: 0,
    llm_signal_ids: [],
    basis: "b",
    axes: [
      {
        id: "claims",
        weight: 0.4,
        effective_weight: 0.4,
        status: "scored",
        subscore: 50,
        signals: [
          { id: "s1", axis: "claims", kind: "k", label: "Unsupported claim", weight_hint: 1, source_url: "https://www.northwind-outdoor.example/a", fetched_at: "2026-10-20", excerpt: "We are eco-friendly.", llm_used: false },
        ],
      },
      { id: "evidence", weight: 0.3, effective_weight: 0.3, status: "missing", subscore: 0, signals: [] },
      { id: "track", weight: 0.2, effective_weight: 0.2, status: "missing", subscore: 0, signals: [] },
      { id: "repair", weight: 0.1, effective_weight: 0.1, status: "missing", subscore: 0, signals: [] },
    ],
    timeline: [],
    could_not_check: ["x"],
    skipped: [],
    generated_at: "2026-10-20",
    sources_count: 1,
    signals_count: 1,
    llm_calls: [],
    ...over,
  }) as ReportV1;

describe("QA fixes: report display", () => {
  it("hides the score below the confidence threshold or with no page fetched", () => {
    expect(displayStatus(report())).toBe("scored");
    expect(displayStatus(report({ confidence: 0 }))).toBe("insufficient_evidence");
    expect(displayStatus(report({ confidence: 39 }))).toBe("insufficient_evidence");
    expect(displayStatus(report({ sources_count: 0 }))).toBe("insufficient_evidence");
    expect(displayStatus(report({ skipped: [{ step: "Fetching current pages", reason: "no page could be fetched from x.example" }] }))).toBe("insufficient_evidence");
  });

  it("strips a duplicated step prefix from a skip reason", () => {
    const step = "Writing the plain-English summary (AI)";
    expect(stripStepPrefix(step, `${step}: no AI answer`)).toBe("no AI answer");
    expect(stripStepPrefix(step, "no API key")).toBe("no API key");
  });

  it("the fallback summary cites only receipt URLs and passes the wording filter", () => {
    const s = fallbackSummary(report());
    expect(s.text).toContain("Northwind");
    expect(s.text).toContain("We are eco-friendly.");
    expect(s.cited_urls).toEqual(["https://www.northwind-outdoor.example/a"]);
    expect(findForbidden(s.text)).toEqual([]);
    expect(fallbackSummary(report({ confidence: 0 })).text).toMatch(/Too little evidence/);
  });
});

describe("QA fixes: website helpers", () => {
  it("names a site from og:site_name, else the cleaned title", () => {
    expect(siteNameFromHtml('<meta property="og:site_name" content="Acme Co"><title>Home | Acme</title>')).toBe("Acme Co");
    expect(siteNameFromHtml("<title>Northwind Outdoor Clothing &amp; Gear</title>")).toBe("Northwind Outdoor Clothing & Gear");
    expect(siteNameFromHtml("<title>Shop - Acme</title>")).toBe("Shop");
    expect(siteNameFromHtml("<p>no title</p>")).toBeNull();
  });

  it("detects typed URLs, adds www., caps and truncates queries", () => {
    expect(looksLikeUrl("northwind-outdoor.example")).toBe(true);
    expect(looksLikeUrl("https://x.com")).toBe(true);
    expect(looksLikeUrl("patagonia")).toBe(false);
    expect(looksLikeUrl("h&m")).toBe(false);
    expect(withWww("https://acme.example")).toBe("https://www.acme.example");
    expect(withWww("https://www.acme.example")).toBeNull();
    expect(capQuery("a".repeat(500))).toHaveLength(100);
    expect(truncate("a".repeat(100))).toHaveLength(60);
  });

  it("resolveSite retries a bare domain with www. and falls back to the domain", async () => {
    const fetcher: Fetcher = {
      get: async (url) => {
        if (url === "https://www.acme.example") return { url, status: 200, body: "<title>Acme</title>", contentType: "text/html", fetchedAt: "", source: "fixture" };
        throw new Error("nope");
      },
    };
    expect(await resolveSite(fetcher, "https://acme.example")).toEqual({ website: "https://www.acme.example", name: "Acme" });
    expect(await resolveSite(fetcher, "https://other.example")).toEqual({ website: "https://other.example", name: "other.example" });
  });
});

describe("QA fixes: run dedupe", () => {
  it("a second identical submit reuses the first run", () => {
    clearRecentRuns();
    let n = 0;
    const runs = { get: () => ({ status: "pending" }) } as never;
    const make = () => ({ id: `run-${++n}` });
    expect(createOnce(runs, "k", make, 1000)).toBe("run-1");
    expect(createOnce(runs, "k", make, 2000)).toBe("run-1");
    expect(createOnce(runs, "k", make, 60_000)).toBe("run-2");
  });
});
