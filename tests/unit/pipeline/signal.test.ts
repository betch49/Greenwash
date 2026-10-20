import { describe, expect, it } from "vitest";
import { ReceiptError, assertReceipt, receiptProblem, withReceipts, type Signal } from "@/lib/pipeline/signal";

const good: Signal = {
  id: "s1",
  axis: "claims",
  kind: "claim.unsupported",
  label: "Unsupported claim",
  weight_hint: 1,
  source_url: "https://www.patagonia.com/our-footprint/",
  fetched_at: "2026-10-20T22:45:00.000Z",
  excerpt: "We are carbon neutral.",
  llm_used: false,
};

describe("assertReceipt (2.5)", () => {
  it("accepts a fully receipted signal", () => {
    expect(() => assertReceipt(good)).not.toThrow();
    expect(receiptProblem(good)).toBeNull();
  });

  it.each([
    ["an empty excerpt", { ...good, excerpt: "" }, /empty excerpt/],
    ["a whitespace-only excerpt", { ...good, excerpt: "   " }, /empty excerpt/],
    ["a missing source_url", { ...good, source_url: undefined }, /missing source_url/],
    ["an empty source_url", { ...good, source_url: "" }, /missing source_url/],
    ["a relative source_url", { ...good, source_url: "/our-footprint" }, /not an absolute URL/],
    ["a non-http source_url", { ...good, source_url: "file:///etc/passwd" }, /not http/],
    ["a missing fetched_at", { ...good, fetched_at: undefined }, /missing fetched_at/],
    ["an invalid fetched_at", { ...good, fetched_at: "yesterday" }, /not an ISO date-time/],
  ])("rejects %s", (_name, signal, message) => {
    expect(() => assertReceipt(signal as Partial<Signal>)).toThrow(ReceiptError);
    expect(() => assertReceipt(signal as Partial<Signal>)).toThrow(message);
  });

  it("rejects null", () => {
    expect(() => assertReceipt(null)).toThrow(ReceiptError);
  });

  it("withReceipts keeps only receipted signals", () => {
    expect(withReceipts([good, { ...good, id: "s2", excerpt: "" }]).map((s) => s.id)).toEqual(["s1"]);
  });
});
