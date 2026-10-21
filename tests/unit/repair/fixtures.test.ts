import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunPagesRepo } from "@/lib/db/run-pages-repo";
import { RunsRepo } from "@/lib/db/runs-repo";
import { runPipeline } from "@/lib/pipeline/run";
import { receiptProblem } from "@/lib/pipeline/signal";
import { discoverStep } from "@/lib/pipeline/steps/discover";
import { fetchPagesStep } from "@/lib/pipeline/steps/fetch-pages";
import { repairStep } from "@/lib/pipeline/steps/repair";
import { frRepairStep } from "@/lib/pipeline/steps/fr-repair";
import { repairApplicability } from "@/lib/repair/applicability";
import { OfflineFetcher } from "../helpers/brands";
import { tempDb } from "../helpers/db";

const NOW = () => new Date("2026-10-20T12:00:00Z");
const REPAIR = "Checking repair information";
const meta = (slug: string) => JSON.parse(readFileSync(join("fixtures", "brands", slug, "meta.json"), "utf8")) as { query: string; website: string; entity: { id: string; name: string; industry?: string } };
const steps = [discoverStep, fetchPagesStep, repairStep, frRepairStep];
const FR_REPAIR = "Checking the French repairability index";

describe("repair axis on the real fixture brands (5.8)", () => {
  let env: ReturnType<typeof tempDb>;
  let runs: RunsRepo;
  let pages: RunPagesRepo;
  beforeEach(() => {
    env = tempDb();
    runs = new RunsRepo(env.db);
    pages = new RunPagesRepo(env.db);
  });
  afterEach(() => env.cleanup());

  const runFor = (slug: string) => {
    const m = meta(slug);
    return runs.create({ query: m.query, brand: m.entity.name, website: m.website, wikidataId: m.entity.id, entity: m.entity });
  };

  it("Oatly (food; Wikidata industry “beverage industry”) ⇒ repair axis not_applicable, zero repair signals, one could-not-check entry", async () => {
    expect(repairApplicability(meta("oatly").entity)).toEqual({ applicable: false, industry: "beverage industry" });
    const fetcher = new OfflineFetcher();
    const out = await runPipeline(runFor("oatly"), { runs, pages, fetcher, now: NOW, steps });
    expect(out.repair_axis).toBe("not_applicable");
    expect(out.signals.filter((s) => s.axis === "repair")).toEqual([]);
    const lines = out.could_not_check.filter((l) => l.startsWith("Repair and ownership"));
    expect(lines).toEqual(["Repair and ownership: not applicable (Wikidata industry “beverage industry”: products are consumed, not repaired); this axis is not scored."]);
    expect(out.progress.find((p) => p.step === REPAIR)).toMatchObject({ status: "skipped", reason: expect.stringMatching(/^not applicable/) });
    expect(fetcher.calls.some((u) => u.includes("ifixit"))).toBe(false);
    // Phase 12 (12.7): the French index step is skipped with the same reason; data.gouv.fr is not contacted.
    expect(out.progress.find((p) => p.step === FR_REPAIR)).toMatchObject({ status: "skipped", reason: expect.stringMatching(/^not applicable/) });
    expect(fetcher.calls.some((u) => u.includes("data.gouv.fr"))).toBe(false);
  });

  it("Fairphone (electronics) ⇒ receipted repair signals from its own pages and from iFixit", async () => {
    expect(repairApplicability(meta("fairphone").entity).applicable).toBe(true);
    const out = await runPipeline(runFor("fairphone"), { runs, pages, fetcher: new OfflineFetcher(), now: NOW, steps });
    expect(out.repair_axis).toBe("applicable");
    expect(out.progress.find((p) => p.step === REPAIR)).toEqual({ step: REPAIR, status: "done" });
    const repair = out.signals.filter((s) => s.axis === "repair");
    expect(repair.length).toBeGreaterThanOrEqual(1);
    for (const s of repair) expect(receiptProblem(s)).toBeNull();
    const kinds = repair.map((s) => s.kind);
    expect(kinds).toEqual(expect.arrayContaining(["repair.manual_found", "repair.spare_parts_found", "repair.warranty_found", "repair.ifixit_guides"]));
    expect(kinds).not.toContain("repair.no_repair_info_found");
    expect(repair.find((s) => s.kind === "repair.warranty_found")!.label).toBe("5-year warranty stated on the brand’s site");
    // Phase 12 (12.7): the French repairability index, with a data.gouv.fr receipt.
    expect(out.progress.find((p) => p.step === FR_REPAIR)).toEqual({ step: FR_REPAIR, status: "done" });
    const fr = repair.filter((s) => s.kind.startsWith("repair.fr_index"));
    expect(fr.map((s) => s.kind)).toEqual(["repair.fr_index_found"]);
    expect(new URL(fr[0].source_url).host).toMatch(/(^|\.)data\.gouv\.fr$/);
    expect(fr[0].excerpt).toContain("Dataset: https://www.data.gouv.fr/datasets/indice-de-reparabilite-organisation-fairphone-1");
    expect(fr[0].excerpt).toContain("Licence: lov2");
    expect(fr[0].llm_used).toBe(false);
  });

  it("Mammut (outdoor apparel, no Wikidata industry) ⇒ applicable; its 2-year guarantee is found; iFixit has no category (could-not-check line)", async () => {
    const out = await runPipeline(runFor("mammut"), { runs, pages, fetcher: new OfflineFetcher(), now: NOW, steps });
    expect(out.repair_axis).toBe("applicable");
    const repair = out.signals.filter((s) => s.axis === "repair");
    expect(repair.map((s) => s.label)).toContain("2-year warranty stated on the brand’s site");
    expect(out.could_not_check).toContain("iFixit repair guides: not checked (iFixit lists no device category named “Mammut”).");
  });

  it("the URL fallback (no entity) counts as durable: repair information is looked for", () => {
    expect(repairApplicability(undefined)).toEqual({ applicable: true });
    expect(repairApplicability({ industry: "electronics industry" })).toEqual({ applicable: true, industry: "electronics industry" });
  });
});
