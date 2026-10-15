/**
 * Non-parametric trend statistics, the same family used by ArcGIS Pro's
 * space-time cube tools (Mann-Kendall) plus Sen's slope for magnitude.
 */

export interface TrendResult {
  /** Mann-Kendall S statistic. */
  s: number;
  /** Standardised test statistic. */
  z: number;
  /** Two-sided p-value. */
  p: number;
  /** Sen's slope, in value units per bin. */
  slope: number;
  /** "stabil" = no significant monotonic trend at the chosen alpha. */
  direction: "naik" | "turun" | "stabil";
  n: number;
}

/** Standard normal CDF (Abramowitz & Stegun 26.2.17). */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

export function mannKendall(values: (number | null)[], alpha = 0.05): TrendResult | null {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] != null);
  const n = pts.length;
  if (n < 4) return null;

  let s = 0;
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const diff = pts[j][1] - pts[i][1];
      s += Math.sign(diff);
      slopes.push(diff / (pts[j][0] - pts[i][0]));
    }
  }

  // Variance with tie correction.
  const ties = new Map<number, number>();
  for (const [, v] of pts) ties.set(v, (ties.get(v) ?? 0) + 1);
  let tieTerm = 0;
  for (const t of ties.values()) if (t > 1) tieTerm += t * (t - 1) * (2 * t + 5);
  const variance = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
  const z = variance > 0 ? (s > 0 ? (s - 1) / Math.sqrt(variance) : s < 0 ? (s + 1) / Math.sqrt(variance) : 0) : 0;
  const p = 2 * (1 - normalCdf(Math.abs(z)));

  slopes.sort((a, b) => a - b);
  const mid = slopes.length / 2;
  const slope = slopes.length % 2 ? slopes[Math.floor(mid)] : (slopes[mid - 1] + slopes[mid]) / 2;

  return { s, z, p, slope, n, direction: p < alpha ? (z > 0 ? "naik" : "turun") : "stabil" };
}

export interface TimeBin {
  start: number;
  end: number;
  /** Indices into the hourly axis that fall into this bin. */
  indices: number[];
}

/** Group an hourly axis into bins of `hours` length (e.g. 24 = daily cube slices). */
export function binTimes(times: number[], hours: number): TimeBin[] {
  const bins: TimeBin[] = [];
  const size = hours * 3_600_000;
  if (!times.length) return bins;
  const origin = times[0];
  times.forEach((t, i) => {
    const k = Math.floor((t - origin) / size);
    (bins[k] ??= { start: origin + k * size, end: origin + (k + 1) * size, indices: [] }).indices.push(i);
  });
  return bins.filter(Boolean);
}

/** Pick a bin size that keeps the cube at a readable height (≤ ~40 slices). */
export function autoBinHours(hoursSpan: number): number {
  for (const h of [1, 3, 6, 12, 24]) if (hoursSpan / h <= 40) return h;
  return 24;
}
