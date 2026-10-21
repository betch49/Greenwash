// Criterion 12.2: the recorded Fairphone CSV parses with the Etalab field names; newest row per
// id_modele; `;`-delimited and BOM-prefixed variants of the same file parse identically.
// (Plan text says 5 rows; the file as served on 2026-10-21 has 6: docs/CHALLENGES.md C-12.1.)
import { describe, expect, it } from "vitest";
import { detectDelimiter, newestPerModel, parseIndexCsv, FrParseError, type FrRow } from "@/lib/registries/fr-repair";
import { FAIRPHONE_TABULAR, frSource } from "./fr-helpers";

const CSV = frSource(FAIRPHONE_TABULAR);

/** The same records re-serialised with `;` (quoting cells that contain `;` or quotes). */
function toSemicolon(csv: string): string {
  const out: string[] = [];
  let field = "";
  let row: string[] = [];
  let q = false;
  const flush = () => {
    row.push(/[;"\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field);
    field = "";
  };
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (q) {
      if (c === '"' && csv[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") flush();
    else if (c === "\n") {
      flush();
      out.push(row.join(";"));
      row = [];
    } else if (c !== "\r") field += c;
  }
  if (field || row.length) {
    flush();
    out.push(row.join(";"));
  }
  return out.join("\r\n");
}

describe("repairability CSV (12.2)", () => {
  const rows = parseIndexCsv(CSV, FAIRPHONE_TABULAR);

  it("Fairphone: 6 rows, each its own id_modele, note_ir 9.3, date_calcul 2025-06-25", () => {
    expect(rows).toHaveLength(6);
    const kept = newestPerModel(rows);
    expect(kept).toHaveLength(6);
    for (const r of kept) {
      expect(r.note_ir).toBe(9.3);
      expect(r.date_calcul).toBe("2025-06-25");
      expect(r.nom_metteur_sur_le_marche).toBe("Fairphone");
      expect(r.categorie_produit).toBe("Smartphone");
    }
    expect(kept.map((r) => r.nom_modele)).toEqual(["F6FPHN-2WH", "F6FPHN-2GR", "F6FPHN-2ZW", "F6FPHN-2WH", "F6FPHN-2GR", "F6FPHN-2ZW"]);
    expect(kept[0].id_modele).toBe("8718819372554");
  });

  it("`;`-delimited and BOM-prefixed variants parse identically", () => {
    const semi = toSemicolon(CSV);
    expect(detectDelimiter(CSV)).toBe(",");
    expect(detectDelimiter(semi)).toBe(";");
    expect(parseIndexCsv(semi, "x")).toEqual(rows);
    expect(parseIndexCsv(`﻿${CSV}`, "x")).toEqual(rows);
    expect(parseIndexCsv(`﻿${semi}`, "x")).toEqual(rows);
  });

  it("keeps the newest date_calcul per id_modele", () => {
    const base: Omit<FrRow, "date_calcul" | "note_ir"> = { id_modele: "A", nom_modele: "M", categorie_produit: "Lave-linge", nom_metteur_sur_le_marche: "X" };
    const kept = newestPerModel([
      { ...base, date_calcul: "2024-01-01", note_ir: 4 },
      { ...base, date_calcul: "2025-03-01", note_ir: 6 },
      { ...base, date_calcul: "2024-06-01", note_ir: 5 },
      { ...base, id_modele: "B", date_calcul: "2023-01-01", note_ir: 7 },
    ]);
    expect(kept.map((r) => [r.id_modele, r.note_ir])).toEqual([
      ["A", 6],
      ["B", 7],
    ]);
  });

  it("French decimal commas and dd/mm/yyyy dates are read; a file without note_ir is a parse error", () => {
    const fr = 'id_modele;nom_modele;categorie_produit;nom_metteur_sur_le_marche;date_calcul;note_ir\n1;"Modèle; A";Lave-linge;X;25/06/2025;"6,4"\n';
    expect(parseIndexCsv(fr, "x")).toEqual([{ id_modele: "1", nom_modele: "Modèle; A", categorie_produit: "Lave-linge", nom_metteur_sur_le_marche: "X", date_calcul: "2025-06-25", note_ir: 6.4 }]);
    expect(() => parseIndexCsv("id_modele,nom_modele,date_calcul\n1,a,2025-01-01\n", "https://t.example/x.csv")).toThrow(FrParseError);
    expect(() => parseIndexCsv("", "u")).toThrow("repairability dataset could not be parsed (u)");
  });
});
