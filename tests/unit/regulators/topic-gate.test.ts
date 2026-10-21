// Criterion 14.7 (ADR-033): a ruling naming the brand is scored on the track axis only when
// its topic is environmental; otherwise it is listed as regulator.ruling_other_topic (0 points).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config from "../../../config/regulators.json";
import raw from "../../../config/weights.json";
import { signalLabels } from "@/lib/copy/wording";
import { guardedPageFetcher } from "@/lib/pipeline/run";
import { asaUk, parseAsaRuling } from "@/lib/regulators/asa-uk";
import { checkRegulator, rulingSignal } from "@/lib/regulators/check";
import { jdpFr, parseJdpDecision } from "@/lib/regulators/jdp-fr";
import { ENVIRONMENTAL_TOPIC, environmentalTerms, rulingTopic, termPattern } from "@/lib/regulators/topic";
import { signalPoints } from "@/lib/score/scorer";
import { OfflineFetcher } from "../helpers/brands";

const NOW = new Date("2026-10-20T12:00:00Z");
const AT = "2026-10-20T00:00:00Z";
const TE = "fixtures/sources/regulators/totalenergies/";
const HEURES_ECO = "https://www.jdp-pub.org/avis/totalenergies-presse/";
const OATLY = "https://www.asa.org.uk/rulings/oatly-uk-ltd-g21-1096286-oatly-uk-ltd.html";
const offline = () => guardedPageFetcher(new OfflineFetcher()).pageFetcher;

describe("lexicon is config, not code", () => {
  it("reads environmentalTopic.terms from config/regulators.json (EN and FR, with the director's terms)", () => {
    expect(ENVIRONMENTAL_TOPIC).toBe(config.environmentalTopic);
    for (const t of ["environment*", "green", "carbon", "climate", "sustainab*", "recycl*", "emission*", "net zero", "biodegrad*", "renewable*", "développement durable", "écolog*", "environnement*", "carbone", "climat*"]) expect(config.environmentalTopic.terms).toContain(t);
  });

  it("whole words, prefix wildcards, accents: 'greenhouse' is not 'green'; 'sustainability' is 'sustainab*'; 'écologique' is 'écolog*'", () => {
    expect(termPattern("green").test("a greenhouse gas")).toBe(false);
    expect(termPattern("green").test("the green claim")).toBe(true);
    expect(termPattern("sustainab*").test("sustainability report")).toBe(true);
    expect(termPattern("écolog*").test("une offre écologique")).toBe(true);
    expect(termPattern("climat*").test("acclimatised")).toBe(false);
    expect(environmentalTerms("A price promotion for electricity tariffs.")).toEqual([]);
  });

  it("the regulator's own topic line decides when present", () => {
    expect(rulingTopic({ title: "X", text: "carbon neutral claim", topic: "Pricing" }).environmental).toBe(false);
    expect(rulingTopic({ title: "X", text: "a price claim", topic: "Environmental claims" }).environmental).toBe(true);
  });

  it("regulator.ruling_other_topic carries 0 points in config/weights.json; regulator.ruling keeps its points", () => {
    expect(raw.points.track["regulator.ruling_other_topic"]).toBe(0);
    expect(raw.points.track["regulator.ruling"]).toBeGreaterThan(0);
    expect(signalPoints({ axis: "track", kind: "regulator.ruling_other_topic", weight_hint: 3 })).toBe(0);
  });
});

describe("real recorded rulings (14.7)", () => {
  it("TotalEnergies 'Heures Eco' (JDP, presse): an electricity price promotion ⇒ other topic, 0 points, honest label", () => {
    const r = parseJdpDecision(readFileSync(`${TE}jdp-avis-totalenergies-presse.html`, "utf8"), HEURES_ECO, AT);
    expect(rulingTopic(r)).toEqual({ environmental: false, how: "lexicon", terms: [] });
    const s = rulingSignal(jdpFr, r, NOW);
    expect(s.kind).toBe("regulator.ruling_other_topic");
    expect(s.label).toBe(signalLabels.rulingOtherTopic(r.advertiser, jdpFr.name, jdpFr.country, r.date, r.outcomeText));
    expect(s.label).toContain("ruling on another topic (topic not established as environmental)");
    expect(signalPoints(s)).toBe(0);
  });

  it("TotalEnergies mobility decisions (JDP) mention développement durable, carbone, climat ⇒ scored", () => {
    for (const f of ["jdp-avis-totalenergies-internet.html", "jdp-avis-total-energies-internet.html"]) {
      const r = parseJdpDecision(readFileSync(`${TE}${f}`, "utf8"), "https://www.jdp-pub.org/avis/x/", AT);
      const t = rulingTopic(r);
      expect(t.environmental, f).toBe(true);
      expect(t.terms, f).toContain("carbone");
      expect(rulingSignal(jdpFr, r, NOW).kind, f).toBe("regulator.ruling");
    }
  });

  it("Oatly (ASA) ⇒ environmental, scored as before", () => {
    const r = parseAsaRuling(readFileSync("fixtures/sources/regulators/oatly/asa-ruling-oatly-uk-ltd-g21-1096286-oatly-uk-ltd.html", "utf8"), OATLY, AT);
    const t = rulingTopic(r);
    expect(t.environmental).toBe(true);
    expect(t.terms).toEqual(expect.arrayContaining(["climate", "carbon", "emission*"]));
    expect(rulingSignal(asaUk, r, NOW).kind).toBe("regulator.ruling");
  });

  it("through checkRegulator on the offline fixtures: Oatly scored; TotalEnergies has one other-topic signal with its receipt", async () => {
    const oatly = await checkRegulator(asaUk, "Oatly AB", offline(), NOW);
    expect(oatly.signals.map((s) => s.kind)).toEqual(["regulator.ruling"]);
    const te = await checkRegulator(jdpFr, "TotalEnergies", offline(), NOW);
    const other = te.signals.filter((s) => s.kind === "regulator.ruling_other_topic");
    expect(other.map((s) => s.source_url)).toEqual([HEURES_ECO]);
    expect(other[0].excerpt.length).toBeGreaterThan(0);
    expect(te.signals.filter((s) => s.kind === "regulator.ruling")).toHaveLength(2);
    // The ruling text never travels in the signal (only the excerpt does).
    expect("text" in other[0]).toBe(false);
  });
});

// QA-2 (Phase 14, builder decision for the director): a complaint the regulator did not uphold scores 0.
describe("not-upheld rulings score 0 (QA-2)", () => {
  it("an environmental ruling with outcome not_upheld is regulator.ruling_not_upheld, 0 points, 'complaint not upheld' label", () => {
    const r = parseAsaRuling(readFileSync("fixtures/sources/regulators/oatly/asa-ruling-oatly-uk-ltd-g21-1096286-oatly-uk-ltd.html", "utf8"), OATLY, AT);
    const s = rulingSignal(asaUk, { ...r, outcome: "not_upheld", outcomeText: "Not upheld" }, NOW);
    expect(s.kind).toBe("regulator.ruling_not_upheld");
    expect(s.label).toContain("complaint not upheld (outcome as published: Not upheld)");
    expect(signalPoints(s)).toBe(0);
    expect(raw.points.track["regulator.ruling_not_upheld"]).toBe(0);
    // Upheld in part (Oatly as recorded) stays scored.
    expect(rulingSignal(asaUk, r, NOW).kind).toBe("regulator.ruling");
  });
});
