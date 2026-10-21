// Criterion 12.3: the licence gate. lov2 (Fairphone) ⇒ repair.fr_index_found with a receipt;
// notspecified (Electrolux France) ⇒ no signal, one could-not-check line with the dataset URL and
// "licence not specified", and its CSV is never fetched (fetcher call log). Real recorded API pages.
import { describe, expect, it } from "vitest";
import { guardedPageFetcher } from "@/lib/pipeline/run";
import { receiptProblem } from "@/lib/pipeline/signal";
import { checkFrRepair, FR_INDEX, parseDatasetsPage, frApiFirstPage } from "@/lib/registries/fr-repair";
import { passesWordingFilter } from "@/lib/copy/forbidden";
import { OfflineFetcher } from "../helpers/brands";
import { ELECTROLUX_PAGE, FAIRPHONE_PAGE, FAIRPHONE_STATIC, FAIRPHONE_TABULAR, frSource } from "./fr-helpers";

const run = async (brand: string) => {
  const offline = new OfflineFetcher();
  const { pageFetcher } = guardedPageFetcher(offline);
  const res = await checkFrRepair(brand, pageFetcher);
  return { res, calls: offline.calls };
};

describe("licence gate (12.3)", () => {
  it("Fairphone (Licence Ouverte 2.0) ⇒ one receipted repair.fr_index_found; the static URL is robots-disallowed, so the tabular export is read", async () => {
    const { res, calls } = await run("Fairphone");
    expect(res.signals).toHaveLength(1);
    const s = res.signals[0];
    expect(receiptProblem(s)).toBeNull();
    expect(s).toMatchObject({ axis: "repair", kind: "repair.fr_index_found", llm_used: false, source_url: FAIRPHONE_TABULAR, entity_name: "Fairphone" });
    expect(s.fetched_at).toMatch(/^2026-10-21T/);
    expect(s.label).toBe("French repairability index published for 6 models (mean 9.3/10, data.gouv.fr)");
    expect(s.excerpt).toBe(
      `Fairphone: F6FPHN-2WH (Smartphone) 9.3/10, calculated 2025-06-25; F6FPHN-2GR (Smartphone) 9.3/10, calculated 2025-06-25; F6FPHN-2ZW (Smartphone) 9.3/10, calculated 2025-06-25; F6FPHN-2WH (Smartphone) 9.3/10, calculated 2025-06-25; F6FPHN-2GR (Smartphone) 9.3/10, calculated 2025-06-25; and 1 more model. Licence: lov2. Dataset: ${FAIRPHONE_PAGE}`,
    );
    // robots.txt was read for static.data.gouv.fr and the disallowed resource URL was not requested.
    expect(calls).toContain("https://static.data.gouv.fr/robots.txt");
    expect(calls).not.toContain(FAIRPHONE_STATIC);
    // ADR-036 (a): no static.data.gouv.fr /resources URL at all is requested while robots.txt disallows it.
    expect(calls.filter((u) => u.startsWith("https://static.data.gouv.fr/resources/"))).toEqual([]);
    expect(calls).toContain(FAIRPHONE_TABULAR);
    expect(res.could_not_check).toEqual([]);
    expect(passesWordingFilter(s.label)).toBe(true);
    for (const l of res.could_not_check) expect(passesWordingFilter(l)).toBe(true);
  });

  it("Electrolux (ELECTROLUX FRANCE, licence notspecified) ⇒ no signal, one could-not-check line, CSV never fetched", async () => {
    const { res, calls } = await run("Electrolux");
    expect(res.signals).toEqual([]);
    expect(res.could_not_check).toHaveLength(1);
    expect(res.could_not_check[0]).toContain(ELECTROLUX_PAGE);
    expect(res.could_not_check[0]).toContain("licence not specified");
    expect(res.could_not_check[0]).toBe(
      `French repairability index: a dataset published on data.gouv.fr by “ELECTROLUX FRANCE” (${ELECTROLUX_PAGE}): licence not specified, so it is linked here but not read or scored.`,
    );
    const page1 = parseDatasetsPage(frSource(frApiFirstPage()), frApiFirstPage());
    const elx = page1.datasets.find((d) => d.publisher === "ELECTROLUX FRANCE")!;
    expect(elx.resources.length).toBeGreaterThan(0);
    for (const r of elx.resources) {
      expect(calls).not.toContain(r.url);
      expect(calls.some((u) => u.includes(r.id))).toBe(false);
    }
    // No CSV route at all was touched for a gated dataset.
    expect(calls.some((u) => u.startsWith("https://tabular-api.data.gouv.fr/api/") || u.startsWith("https://static.data.gouv.fr/resources/"))).toBe(false);
  });

  it("the gate reads config: removing lov2 from openLicences gates Fairphone too", async () => {
    const offline = new OfflineFetcher();
    const { pageFetcher } = guardedPageFetcher(offline);
    const res = await checkFrRepair("Fairphone", pageFetcher, { ...FR_INDEX, openLicences: ["etalab-2.0"] });
    expect(res.signals).toEqual([]);
    expect(res.could_not_check).toEqual([`French repairability index: a dataset published on data.gouv.fr by “Fairphone” (${FAIRPHONE_PAGE}): licence “lov2” is not an open licence, so it is linked here but not read or scored.`]);
    expect(offline.calls).not.toContain(FAIRPHONE_TABULAR);
  });

  it("several gated datasets of one publisher ⇒ one line listing at most maxDatasetUrlsInLine URLs", async () => {
    const { res } = await run("Vestel");
    expect(res.signals.map((s) => s.kind)).toEqual(expect.any(Array));
    const gated = res.could_not_check.filter((l) => l.includes("licence not specified"));
    expect(gated).toHaveLength(1);
    expect(gated[0]).toMatch(/^French repairability index: \d+ datasets published on data\.gouv\.fr by “Vestel France” \(https:\/\/www\.data\.gouv\.fr\/datasets\/[^,]+, [^,]+, [^,]+ and \d+ more\): licence not specified, so they are linked here but not read or scored\.$/);
  });
});
