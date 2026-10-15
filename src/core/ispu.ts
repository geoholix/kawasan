import type { IconName } from "./modules";
import type { Indicator, Pollutant } from "./types";

/**
 * Indeks Standar Pencemar Udara (ISPU) — Peraturan Menteri LHK
 * No. P.14/MENLHK/SETJEN/KUM.1/7/2020.
 *
 * The regulation averages PM over 24 h and CO over 8 h. This app applies the
 * breakpoints to hourly values, so the result is an *indicative* ISPU that
 * shows how the air evolves hour by hour.
 */

export interface IspuCategory {
  id: "baik" | "sedang" | "tidak-sehat" | "sangat-tidak-sehat" | "berbahaya";
  label: string;
  min: number;
  max: number;
  color: string;
  /** Calcite icon name shown next to the label so category is never color-only. */
  icon: IconName;
  advice: string;
}

// Official colours: green, blue, yellow, red, black. "Berbahaya" uses a very
// dark maroon instead of pure black so it stays visible on the dark basemap.
export const ISPU_CATEGORIES: IspuCategory[] = [
  { id: "baik", label: "Baik", min: 0, max: 50, color: "#00a651", icon: "smile", advice: "Kualitas udara sangat baik untuk aktivitas luar ruangan." },
  { id: "sedang", label: "Sedang", min: 51, max: 100, color: "#0072bc", icon: "check-circle", advice: "Masih dapat diterima; kelompok sensitif kurangi aktivitas berat." },
  { id: "tidak-sehat", label: "Tidak Sehat", min: 101, max: 200, color: "#f7d117", icon: "exclamation-mark-triangle", advice: "Kurangi aktivitas luar ruangan, gunakan masker." },
  { id: "sangat-tidak-sehat", label: "Sangat Tidak Sehat", min: 201, max: 300, color: "#ed1c24", icon: "exclamation-mark-circle", advice: "Hindari aktivitas luar ruangan." },
  { id: "berbahaya", label: "Berbahaya", min: 301, max: 500, color: "#4a0a14", icon: "x-octagon", advice: "Tetap di dalam ruangan dan tutup ventilasi." },
];

const ISPU_STEPS = [0, 50, 100, 200, 300, 500];

/** Concentration breakpoints (µg/m³) matching ISPU_STEPS. */
const BREAKPOINTS: Record<Pollutant, number[]> = {
  pm10: [0, 50, 150, 350, 420, 500],
  pm2_5: [0, 15.5, 55.4, 150.4, 250.4, 500],
  so2: [0, 52, 180, 400, 800, 1200],
  co: [0, 4000, 8000, 15000, 30000, 45000],
  o3: [0, 120, 235, 400, 800, 1000],
  no2: [0, 80, 200, 1130, 2260, 3000],
};

export const POLLUTANTS: Pollutant[] = ["pm2_5", "pm10", "no2", "o3", "so2", "co"];

export const INDICATOR_LABELS: Record<Indicator, string> = {
  ispu: "ISPU",
  pm2_5: "PM2.5",
  pm10: "PM10",
  no2: "NO₂",
  o3: "O₃",
  so2: "SO₂",
  co: "CO",
};

export function indicatorUnit(indicator: Indicator): string {
  return indicator === "ispu" ? "" : "µg/m³";
}

/** Linear interpolation inside the breakpoint segment, per the regulation's formula. */
export function subIndex(pollutant: Pollutant, concentration: number | null | undefined): number | null {
  if (concentration == null || Number.isNaN(concentration)) return null;
  const bp = BREAKPOINTS[pollutant];
  const x = Math.max(0, concentration);
  for (let i = 1; i < bp.length; i++) {
    if (x <= bp[i]) {
      const [xb, xa] = [bp[i - 1], bp[i]];
      const [ib, ia] = [ISPU_STEPS[i - 1], ISPU_STEPS[i]];
      return Math.round(((ia - ib) / (xa - xb)) * (x - xb) + ib);
    }
  }
  return 500;
}

export interface IspuResult {
  value: number | null;
  dominant: Pollutant | null;
}

/** ISPU of a set of concentrations = the highest sub-index; that pollutant is the dominant one. */
export function ispu(values: Partial<Record<Pollutant, number | null>>): IspuResult {
  let value: number | null = null;
  let dominant: Pollutant | null = null;
  for (const p of POLLUTANTS) {
    const si = subIndex(p, values[p]);
    if (si != null && (value == null || si > value)) {
      value = si;
      dominant = p;
    }
  }
  return { value, dominant };
}

export function categoryOf(ispuValue: number | null | undefined): IspuCategory | null {
  if (ispuValue == null) return null;
  return ISPU_CATEGORIES.find((c) => ispuValue <= c.max) ?? ISPU_CATEGORIES[ISPU_CATEGORIES.length - 1];
}

export function categoryIndex(ispuValue: number | null | undefined): number {
  const c = categoryOf(ispuValue);
  return c ? ISPU_CATEGORIES.indexOf(c) : -1;
}

/** Concentration thresholds for an indicator (used to draw guide lines on charts). */
export function thresholdsFor(indicator: Indicator): { value: number; category: IspuCategory }[] {
  const steps = indicator === "ispu" ? ISPU_STEPS : BREAKPOINTS[indicator];
  return ISPU_CATEGORIES.slice(0, 4).map((category, i) => ({ value: steps[i + 1], category }));
}
