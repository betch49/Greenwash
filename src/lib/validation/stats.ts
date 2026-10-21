// Separation statistics for the validation harness (PLAN Phase 10 deliverable 2).
// Pure functions, no I/O. Evaluation only: nothing here feeds a score.

/**
 * Mann–Whitney AUC: the probability that a randomly chosen `positives` value
 * (flagged brand's score) is higher than a randomly chosen `negatives` value
 * (well-rated brand's score), ties counted as one half. 1 = perfect separation
 * in the expected direction, 0.5 = no separation, 0 = perfectly reversed.
 * Returns null when either group is empty.
 */
export function auc(positives: readonly number[], negatives: readonly number[]): number | null {
  if (positives.length === 0 || negatives.length === 0) return null;
  let wins = 0;
  for (const p of positives) {
    for (const n of negatives) {
      if (p > n) wins += 1;
      else if (p === n) wins += 0.5;
    }
  }
  return wins / (positives.length * negatives.length);
}

export const mean = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** mean(a) − mean(b); null when either is empty. */
export function meanDifference(a: readonly number[], b: readonly number[]): number | null {
  const ma = mean(a);
  const mb = mean(b);
  return ma === null || mb === null ? null : ma - mb;
}

/** median(a) − median(b); null when either is empty. */
export function medianDifference(a: readonly number[], b: readonly number[]): number | null {
  const ma = median(a);
  const mb = median(b);
  return ma === null || mb === null ? null : ma - mb;
}

/** Ranks starting at 1; tied values share the average of their ranks. */
export function ranks(xs: readonly number[]): number[] {
  const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(xs.length);
  for (let k = 0; k < order.length; ) {
    let j = k;
    while (j + 1 < order.length && order[j + 1].v === order[k].v) j++;
    const avg = (k + j) / 2 + 1;
    for (let t = k; t <= j; t++) out[order[t].i] = avg;
    k = j + 1;
  }
  return out;
}

/**
 * Spearman rank correlation (Pearson correlation of the tie-averaged ranks).
 * Null when there are fewer than 3 pairs or either variable is constant.
 */
export function spearman(x: readonly number[], y: readonly number[]): number | null {
  if (x.length !== y.length) throw new Error("spearman: x and y differ in length");
  if (x.length < 3) return null;
  const rx = ranks(x);
  const ry = ranks(y);
  const mx = mean(rx)!;
  const my = mean(ry)!;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < rx.length; i++) {
    sxy += (rx[i] - mx) * (ry[i] - my);
    sxx += (rx[i] - mx) ** 2;
    syy += (ry[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}
