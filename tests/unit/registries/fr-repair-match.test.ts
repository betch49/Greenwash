// Criterion 12.5: publisher matching by the ADR-019 equality rule.
import { describe, expect, it } from "vitest";
import { guardedPageFetcher } from "@/lib/pipeline/run";
import { checkFrRepair, matchDataset } from "@/lib/registries/fr-repair";
import { OfflineFetcher } from "../helpers/brands";
import { LogFetcher, firstPage, syntheticApiPage } from "./fr-helpers";

const ds = (publisher: string | null, title = "Indice de réparabilité") => ({ publisher, title });

describe("dataset matching (12.5)", () => {
  it("“ELECTROLUX FRANCE” vs “Electrolux” ⇒ scored (qualifier “france” stripped)", () => {
    expect(matchDataset("Electrolux", ds("ELECTROLUX FRANCE"))).toEqual({ kind: "scored", entity: "ELECTROLUX FRANCE" });
  });

  it("“Robert Bosch France SAS” vs “Bosch” ⇒ possible, not scored", () => {
    expect(matchDataset("Bosch", ds("Robert Bosch France SAS"))).toEqual({ kind: "possible", entity: "Robert Bosch France SAS" });
  });

  it("“Fairphone” vs “Fairphone” ⇒ scored", () => {
    expect(matchDataset("Fairphone", ds("Fairphone"))).toEqual({ kind: "scored", entity: "Fairphone" });
  });

  it("a brand only in the title ⇒ possible; no whole-word occurrence ⇒ none", () => {
    expect(matchDataset("Bosch", ds("Some Distributor", "Indices de réparabilité Outillage Bosch")).kind).toBe("possible");
    expect(matchDataset("Fair", ds("Fairphone", "Indice de réparabilité (organisation Fairphone)"))).toEqual({ kind: "none" });
    expect(matchDataset("Mammut", ds(null, "Indice de réparabilité"))).toEqual({ kind: "none" });
  });

  it("real API pages: Bosch ⇒ a possible-match line, no signal; nothing fetched for it (licence notspecified)", async () => {
    const offline = new OfflineFetcher();
    const res = await checkFrRepair("Bosch", guardedPageFetcher(offline).pageFetcher);
    expect(res.signals).toEqual([]);
    expect(res.could_not_check).toEqual([
      "Possible match, not scored: French repairability dataset on data.gouv.fr published by “Robert Bosch France SAS” (https://www.data.gouv.fr/datasets/indices-de-reparabilite-outillage-bosch); the publisher’s name is not the brand’s name, so we do not attribute it.",
    ]);
    expect(offline.calls.some((u) => u.includes("tabular-api") || u.includes("/resources/"))).toBe(false);
  });

  it("real API pages: Mammut has no dataset ⇒ one could-not-check line", async () => {
    const res = await checkFrRepair("Mammut", guardedPageFetcher(new OfflineFetcher()).pageFetcher);
    expect(res.signals).toEqual([]);
    expect(res.could_not_check).toEqual(["French repairability index: none of the 115 repairability datasets listed on data.gouv.fr is published under the brand’s name (the index covers products sold in France only)."]);
  });

  it("an open possible-match dataset counts only the rows whose nom_metteur_sur_le_marche is the brand", async () => {
    const url = "https://files.quillmoor-foods.example/ir.csv";
    const f = new LogFetcher({
      [firstPage()]: syntheticApiPage([{ id: "d1", publisher: "Northwind Outdoor Distribution Group", license: "lov2", csvUrl: url }]),
      [url]: "id_modele,nom_modele,categorie_produit,nom_metteur_sur_le_marche,date_calcul,note_ir\n1,A,Lave-linge,Northwind Outdoor SAS,2026-01-01,2.0\n2,B,Lave-linge,Other Brand,2026-01-01,9.0\n",
    });
    const res = await checkFrRepair("Northwind Outdoor", f);
    expect(res.signals).toHaveLength(1);
    expect(res.signals[0]).toMatchObject({ kind: "repair.fr_index_low", entity_name: "Northwind Outdoor SAS" });
    expect(res.signals[0].excerpt).not.toContain("Other Brand");
    const none = await checkFrRepair("Northwind", new LogFetcher({ [firstPage()]: syntheticApiPage([{ id: "d1", publisher: "Northwind Outdoor Distribution Group", license: "lov2", csvUrl: url }]), [url]: "id_modele,nom_modele,categorie_produit,nom_metteur_sur_le_marche,date_calcul,note_ir\n2,B,Lave-linge,Other Brand,2026-01-01,9.0\n" }));
    expect(none.signals).toEqual([]);
    expect(none.could_not_check[0]).toMatch(/^Possible match, not scored: /);
  });
});
