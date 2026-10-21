// Criterion 12.4: synthetic fictional-brand CSVs (`.example`, ADR-011). Mean 3.2 ⇒ repair.fr_index_low;
// mean 5.0 ⇒ repair.fr_index_found only; the threshold is read from config (changed here, observed).
import { describe, expect, it } from "vitest";
import { checkFrRepair, FR_INDEX, type FrIndexConfig } from "@/lib/registries/fr-repair";
import { axisSubscore, rawPoints } from "@/lib/score/scorer";
import { WEIGHTS } from "@/lib/score/weights";
import { LogFetcher, firstPage, syntheticApiPage } from "./fr-helpers";

const CSV_URL = "https://files.northwind-outdoor.example/indice.csv";
const header = "id_modele,nom_modele,categorie_produit,nom_metteur_sur_le_marche,date_calcul,note_ir";
const csv = (scores: number[]) => [header, ...scores.map((s, i) => `NW-${i},Northwind Kettle ${i},Bouilloire,Northwind Outdoor,2026-01-0${i + 1},${s}`)].join("\n");

async function check(scores: number[], cfg: FrIndexConfig = FR_INDEX) {
  const f = new LogFetcher({
    [firstPage(cfg)]: syntheticApiPage([{ id: "nw1", publisher: "Northwind Outdoor SAS", license: "lov2", csvUrl: CSV_URL }]),
    [CSV_URL]: csv(scores),
  });
  return checkFrRepair("Northwind Outdoor", f, cfg);
}

describe("index threshold (12.4)", () => {
  it("the configured threshold is the director's 5.0 and fr_index_low carries risk points from config", () => {
    expect(FR_INDEX.lowThreshold).toBe(5);
    expect(WEIGHTS.points.repair["repair.fr_index_low"]).toBe(30);
    expect(WEIGHTS.points.repair["repair.fr_index_found"]).toBe(0);
  });

  it("mean 3.2 ⇒ one repair.fr_index_low (instead of fr_index_found)", async () => {
    const res = await check([2, 3, 4.6]);
    expect(res.signals.map((s) => s.kind)).toEqual(["repair.fr_index_low"]);
    expect(res.signals[0].label).toBe("Risk signal: mean French repairability index 3.2/10 over 3 models, below 5.0/10 (data.gouv.fr)");
    expect(res.signals[0]).toMatchObject({ source_url: CSV_URL, entity_name: "Northwind Outdoor SAS", llm_used: false });
    expect(res.signals[0].excerpt).toContain("Northwind Kettle 0 (Bouilloire) 2/10, calculated 2026-01-01");
  });

  it("mean 5.0 ⇒ repair.fr_index_found only", async () => {
    const res = await check([4, 6, 5]);
    expect(res.signals.map((s) => s.kind)).toEqual(["repair.fr_index_found"]);
  });

  it("the threshold is read from config: raising it to 5.5 turns the same mean 5.0 into fr_index_low", async () => {
    const res = await check([4, 6, 5], { ...FR_INDEX, lowThreshold: 5.5 });
    expect(res.signals.map((s) => s.kind)).toEqual(["repair.fr_index_low"]);
    const lower = await check([2, 3, 4.6], { ...FR_INDEX, lowThreshold: 3 });
    expect(lower.signals.map((s) => s.kind)).toEqual(["repair.fr_index_found"]);
  });

  it("the scorer gives fr_index_low the configured points and fr_index_found none", async () => {
    const low = (await check([2, 3, 4.6])).signals;
    const ok = (await check([4, 6, 5])).signals;
    expect(axisSubscore("repair", rawPoints(low), 0)).toBe(30);
    expect(axisSubscore("repair", rawPoints(ok), 0)).toBe(0);
  });

  it("rows without a numeric note_ir are excluded from the mean; none at all ⇒ parse failure, no signal", async () => {
    const f = new LogFetcher({
      [firstPage()]: syntheticApiPage([{ id: "nw1", publisher: "Northwind Outdoor", license: "lov2", csvUrl: CSV_URL }]),
      [CSV_URL]: `${header}\nNW-1,K,Bouilloire,Northwind Outdoor,2026-01-01,\n`,
    });
    const res = await checkFrRepair("Northwind Outdoor", f);
    expect(res.signals).toEqual([]);
    expect(res.parseFailures).toEqual([`repairability dataset could not be parsed (${CSV_URL})`]);
  });
});
