import { describe, expect, it } from "vitest";
import { pipelineClock } from "@/lib/services";

describe("pipeline clock (GR_FIXED_NOW, offline only)", () => {
  it("offline fixture mode honours GR_FIXED_NOW", () => {
    const now = pipelineClock({ GR_OFFLINE_FIXTURES: "1", GR_FIXED_NOW: "2026-10-20T00:00:00Z" });
    expect(now().toISOString()).toBe("2026-10-20T00:00:00.000Z");
  });

  it("outside offline mode GR_FIXED_NOW is ignored: the real clock is used", () => {
    const before = Date.now();
    const now = pipelineClock({ GR_FIXED_NOW: "2001-01-01T00:00:00Z" })().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(pipelineClock({ GR_OFFLINE_FIXTURES: "0", GR_FIXED_NOW: "2001-01-01T00:00:00Z" })().getUTCFullYear()).not.toBe(2001);
  });

  it("an unparsable or missing value falls back to the real clock", () => {
    expect(pipelineClock({ GR_OFFLINE_FIXTURES: "1", GR_FIXED_NOW: "soon" })().getTime()).toBeGreaterThan(Date.parse("2026-01-01"));
    expect(pipelineClock({ GR_OFFLINE_FIXTURES: "1" })().getTime()).toBeGreaterThan(Date.parse("2026-01-01"));
  });
});
