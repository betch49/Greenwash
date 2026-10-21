import { describe, expect, it } from "vitest";
import type { FetchResult, Fetcher } from "@/lib/fetch/fetcher";
import { guardedPageFetcher } from "@/lib/pipeline/run";
import { receiptProblem } from "@/lib/pipeline/signal";
import { ifixitCategoryUrl, lookupIfixit } from "@/lib/repair/ifixit";
import { OfflineFetcher } from "../helpers/brands";

const offline = () => guardedPageFetcher(new OfflineFetcher()).pageFetcher;

describe("iFixit lookup on the real recorded Fairphone responses (5.6)", () => {
  it("yields repair.ifixit_* signals with an ifixit.com receipt and the device or guide title in the excerpt", async () => {
    const r = await lookupIfixit("Fairphone", offline());
    expect(r.skipped).toBeUndefined();
    const kinds = r.signals.map((s) => s.kind);
    expect(kinds).toContain("repair.ifixit_devices");
    expect(kinds).toContain("repair.ifixit_guides");
    expect(kinds).toContain("repair.ifixit_score");
    for (const s of r.signals) {
      expect(receiptProblem(s)).toBeNull();
      expect(s.kind).toMatch(/^repair\.ifixit_/);
      expect(s.axis).toBe("repair");
      expect(new URL(s.source_url).host).toBe("www.ifixit.com");
      expect(s.llm_used).toBe(false);
    }
    const guides = r.signals.find((s) => s.kind === "repair.ifixit_guides" && s.source_url === ifixitCategoryUrl("Fairphone 5"))!;
    expect(guides.label).toBe("iFixit has 11 repair guides for Fairphone 5");
    expect(guides.excerpt).toContain("Fairphone 5 Battery Replacement");
    const score = r.signals.find((s) => s.kind === "repair.ifixit_score" && s.source_url === ifixitCategoryUrl("Fairphone 5"))!;
    expect(score.label).toBe("iFixit repairability score for Fairphone 5: 10/10");
    expect(score.excerpt).toContain("Fairphone 5");
    expect(r.signals.find((s) => s.kind === "repair.ifixit_devices")!.excerpt).toContain("Fairphone 4");
  });

  it("uses only the endpoint robots.txt allows (/api/2.0/wikis), never /api/2.0/search", async () => {
    const inner = new OfflineFetcher();
    const r = await lookupIfixit("Fairphone", guardedPageFetcher(inner).pageFetcher);
    expect(r.signals.length).toBeGreaterThan(0);
    for (const url of inner.calls.filter((u) => u.includes("/api/"))) expect(new URL(url).pathname).toMatch(/^\/api\/2\.0\/wikis\/CATEGORY\//);
  });

  it("no category under the brand's name (Mammut, a real 404) ⇒ no signal and a could-not-check line", async () => {
    const r = await lookupIfixit("Mammut", offline());
    expect(r.signals).toEqual([]);
    expect(r.could_not_check).toEqual(["iFixit repair guides: not checked (iFixit lists no device category named “Mammut”)."]);
  });

  it("iFixit unreachable ⇒ skipped with a reason, no signal", async () => {
    const inner = new OfflineFetcher();
    const fetcher: Fetcher = {
      get: async (url): Promise<FetchResult> =>
        url.includes("/api/") ? { url, status: 503, body: "", contentType: "text/html", fetchedAt: "2026-10-20T00:00:00Z", source: "network" } : inner.get(url),
    };
    const r = await lookupIfixit("Fairphone", guardedPageFetcher(fetcher).pageFetcher);
    expect(r.signals).toEqual([]);
    expect(r.skipped).toBe("iFixit unreachable (HTTP 503)");
    expect(r.could_not_check).toEqual(["iFixit repair guides: not checked (iFixit unreachable (HTTP 503))."]);
  });

  it("a category whose title is not the brand's name is not attributed", async () => {
    const fetcher: Fetcher = {
      get: async (url): Promise<FetchResult> => ({
        url,
        status: 200,
        body: url.endsWith("robots.txt") ? "User-agent: *\nAllow: /\n" : JSON.stringify({ title: "Acme Widgets", children: [{ title: "Widget 1" }] }),
        contentType: url.endsWith("robots.txt") ? "text/plain" : "application/json",
        fetchedAt: "2026-10-20T00:00:00Z",
        source: "fixture",
      }),
    };
    const r = await lookupIfixit("Acme", guardedPageFetcher(fetcher).pageFetcher);
    expect(r.signals).toEqual([]);
  });
});
