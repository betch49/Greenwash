// docs/METHODOLOGY.md Section 7 and the /methodology tables are generated from
// config/weights.json here, so no weight is ever copied by hand (PLAN 6.5, 6.8).
import { scoreWording } from "../copy/wording";
import { AXES, WEIGHTS, type Weights } from "./weights";

export const pct = (x: number) => `${Math.round(x * 100)}%`;

export interface WeightRow {
  axis: (typeof AXES)[number];
  name: string;
  weight: number;
  cap: number;
}
export interface PointRow {
  axis: (typeof AXES)[number];
  kind: string;
  points: number;
}
export interface ParamRow {
  key: string;
  value: string;
}

export const weightRows = (w: Weights = WEIGHTS): WeightRow[] => AXES.map((a) => ({ axis: a, name: scoreWording.axisNames[a], weight: w.axes[a], cap: w.caps[a] }));

export const pointRows = (w: Weights = WEIGHTS): PointRow[] => AXES.flatMap((a) => Object.entries(w.points[a]).map(([kind, points]) => ({ axis: a, kind, points })));

/** Every other number in the file, flattened to dotted keys (lists joined with ", "). */
export function paramRows(w: Weights = WEIGHTS): ParamRow[] {
  const out: ParamRow[] = [];
  const walk = (prefix: string, v: unknown) => {
    if (Array.isArray(v)) out.push({ key: prefix, value: v.join(", ") });
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(prefix ? `${prefix}.${k}` : k, x);
    else out.push({ key: prefix, value: String(v) });
  };
  const { claimsRate, defaultWeightHint, regulatorRuling, sbti, llmGuard, llm, labels, confidence } = w;
  walk("", { claimsRate, defaultWeightHint, regulatorRuling, sbti, llmGuard, llm, labels, confidence });
  // Phase 13: litigation status multipliers (a list of keyword rules, shown one rule per row).
  out.push({ key: "litigation.baseHint", value: String(w.litigation.baseHint) });
  w.litigation.statusMultipliers.forEach((r, i) => out.push({ key: `litigation.statusMultipliers[${i}]`, value: `${r.keywords.join(", ")} ⇒ ${r.multiplier}` }));
  out.push({ key: "litigation.unknownMultiplier", value: String(w.litigation.unknownMultiplier) });
  return out;
}

/** The body of docs/METHODOLOGY.md Section 7 (everything after its heading line). */
export function weightsMarkdown(w: Weights = WEIGHTS): string {
  const lines = [
    `Generated from \`config/weights.json\` (version ${w.version}) by \`weightsMarkdown()\` in \`src/lib/score/methodology.ts\`; \`tests/unit/score/methodology-sync.test.ts\` fails if this section and the file differ. The /methodology page renders the same tables from the same file.`,
    "",
    "### Axis weights",
    "",
    "| Axis | Weight | Cap |",
    "|---|---|---|",
    ...weightRows(w).map((r) => `| \`${r.axis}\` (${r.name}) | ${pct(r.weight)} | ${r.cap} |`),
    "",
    "### Points per signal kind",
    "",
    "| Axis | Kind | Points |",
    "|---|---|---|",
    ...pointRows(w).map((r) => `| \`${r.axis}\` | \`${r.kind}\` | ${r.points} |`),
    "",
    "### Other parameters",
    "",
    "| Parameter | Value |",
    "|---|---|",
    ...paramRows(w).map((r) => `| \`${r.key}\` | ${r.value} |`),
  ];
  return lines.join("\n");
}
