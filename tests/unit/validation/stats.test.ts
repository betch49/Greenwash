// Criterion 10.2: AUC, mean/median difference and Spearman on hand-computed cases.
import { describe, expect, it } from "vitest";
import { auc, mean, meanDifference, median, medianDifference, ranks, spearman } from "@/lib/validation/stats";

describe("auc (Mann–Whitney, 10.2)", () => {
  it("perfect separation ⇒ 1, reversed ⇒ 0, identical ⇒ 0.5", () => {
    expect(auc([60, 70, 80], [10, 20])).toBe(1);
    expect(auc([10, 20], [60, 70, 80])).toBe(0);
    expect(auc([30, 30, 30], [30, 30])).toBe(0.5);
  });
  it("ties earn half credit", () => {
    // pairs: (50,40) win, (50,50) tie, (30,40) loss, (30,50) loss ⇒ (1 + 0.5) / 4
    expect(auc([50, 30], [40, 50])).toBe(0.375);
    // pairs: (2,1) win, (2,2) tie, (2,3) loss, (3,1) win, (3,2) win, (3,3) tie ⇒ 4 / 6
    expect(auc([2, 3], [1, 2, 3])).toBeCloseTo(4 / 6, 12);
  });
  it("an empty group ⇒ null", () => {
    expect(auc([], [1])).toBeNull();
    expect(auc([1], [])).toBeNull();
  });
});

describe("mean and median difference", () => {
  it("documented inputs", () => {
    expect(mean([1, 2, 3, 6])).toBe(3);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(meanDifference([10, 20, 30], [5, 5])).toBe(15);
    expect(medianDifference([10, 20, 90], [1, 3])).toBe(18);
    expect(meanDifference([], [1])).toBeNull();
    expect(medianDifference([1], [])).toBeNull();
  });
});

describe("spearman", () => {
  it("ranks average ties", () => {
    expect(ranks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });
  it("monotone ⇒ 1, reversed ⇒ −1", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 400])).toBeCloseTo(1, 12);
    expect(spearman([1, 2, 3, 4], [9, 7, 5, 1])).toBeCloseTo(-1, 12);
  });
  it("a documented case with ties", () => {
    // x ranks [1,2,3,4,5]; y = [2,1,4,3,5] ⇒ ρ = 1 − 6·Σd²/(n(n²−1)) = 1 − 6·4/120 = 0.8
    expect(spearman([1, 2, 3, 4, 5], [2, 1, 4, 3, 5])).toBeCloseTo(0.8, 12);
    // with ties: x = [1,2,2,3], y = [1,2,3,4]; ranks x = [1,2.5,2.5,4] ⇒ Pearson on ranks = 0.9486832980505138
    expect(spearman([1, 2, 2, 3], [1, 2, 3, 4])).toBeCloseTo(0.9486832980505138, 12);
  });
  it("fewer than 3 pairs or a constant variable ⇒ null; length mismatch throws", () => {
    expect(spearman([1, 2], [1, 2])).toBeNull();
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(() => spearman([1, 2, 3], [1, 2])).toThrow();
  });
});
