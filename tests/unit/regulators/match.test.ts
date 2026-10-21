import { describe, expect, it } from "vitest";
import { entityNames, matchEntity, normaliseEntity, searchQuery } from "@/lib/regulators/match";

const adv = (advertiser: string) => ({ title: `ASA Ruling on ${advertiser}`, advertiser });

describe("conservative regulator matching (5.3)", () => {
  it("normalises: lowercase, diacritics, punctuation, legal suffixes, trailing qualifiers", () => {
    expect(normaliseEntity("Shell UK Ltd")).toBe("shell");
    expect(normaliseEntity("Oatly UK Ltd")).toBe("oatly");
    expect(normaliseEntity("Société Générale S.A.")).toBe("societe generale");
    expect(normaliseEntity("Acme GmbH")).toBe("acme");
    expect(normaliseEntity("Acme B.V.")).toBe("acme");
    expect(normaliseEntity("Patagonia, Inc.")).toBe("patagonia");
    expect(normaliseEntity("Shell Energy Retail Ltd")).toBe("shell energy retail");
  });

  it("splits trading names", () => {
    expect(entityNames("Oatly UK Ltd t/a Oatly")).toEqual(["Oatly UK Ltd", "Oatly"]);
    expect(entityNames("Viridian International Ltd trading as Viridian")).toEqual(["Viridian International Ltd", "Viridian"]);
  });

  it("“Shell” vs advertiser “Shell UK Ltd” ⇒ scored", () => {
    expect(matchEntity("Shell", adv("Shell UK Ltd"))).toBe("scored");
    expect(matchEntity("Shell plc", adv("Shell UK Ltd t/a Shell"))).toBe("scored");
  });

  it("“Shell” vs “Shell Energy Retail” ⇒ possible: the whole-word rule finds “shell”, but “energy retail” is part of the name, so the ruling names a different entity (a separately branded retail supplier) and is not scored", () => {
    expect(matchEntity("Shell", adv("Shell Energy Retail Ltd"))).toBe("possible");
    expect(matchEntity("Shell", adv("Shell Energy UK"))).toBe("possible");
  });

  it("“Patagonia” vs “Patagonia Provisions Ltd” ⇒ possible", () => {
    expect(matchEntity("Patagonia", adv("Patagonia Provisions Ltd"))).toBe("possible");
  });

  it("“Acme” vs “Acme Widgets” ⇒ possible", () => {
    expect(matchEntity("Acme", adv("Acme Widgets"))).toBe("possible");
  });

  it("“Pata” vs “Patagonia” ⇒ no match (not a whole word)", () => {
    expect(matchEntity("Pata", adv("Patagonia"))).toBe("none");
    expect(matchEntity("Pata", adv("Patagonia Provisions Ltd"))).toBe("none");
  });

  it("other cases: legal suffix on the brand, spacing, unrelated hits, title-only pages", () => {
    expect(matchEntity("Oatly AB", adv("Oatly UK Ltd t/a Oatly"))).toBe("scored");
    expect(matchEntity("TotalEnergies", { title: "TOTAL ENERGIES", advertiser: "TOTAL ENERGIES" })).toBe("scored");
    expect(matchEntity("Shell", adv("LifeSafe Technologies Ltd"))).toBe("none");
    expect(matchEntity("Fairphone", { title: "FAIRPHONE" })).toBe("scored");
    expect(matchEntity("Fair", { title: "FAIRPHONE" })).toBe("none");
    expect(matchEntity("", adv("Shell UK Ltd"))).toBe("none");
  });

  it("the search query is the brand without its legal suffix", () => {
    expect(searchQuery("Oatly AB")).toBe("Oatly");
    expect(searchQuery("Mammut")).toBe("Mammut");
    expect(searchQuery("Patagonia, Inc.")).toBe("Patagonia");
  });
});
