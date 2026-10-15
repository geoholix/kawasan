import { Store } from "../core/store";

export interface TreeSpecies {
  id: string;
  name: string;
  latin: string;
  /** CO₂ sequestration of one mature tree, kg/year. */
  co2KgPerYear: number;
  /** PM2.5 removed by deposition on leaves, g/year (mature tree). */
  pm25GramPerYear: number;
  heightM: number;
  crownM: number;
  maturityYears: number;
}

/** A group of trees planted together (one click or one bulk action). */
export interface TreePlanting {
  id: string;
  speciesId: string;
  /** Individual tree positions (WGS84). Bulk plantings keep only a sample for display. */
  positions: [number, number][];
  /** Real number of trees represented by this planting. */
  count: number;
  label: string;
}

export interface GreeningState {
  species: TreeSpecies[];
  status: string;
  plantings: TreePlanting[];
  selectedSpecies: string;
  /** Trees per click. */
  clusterSize: number;
  /** Cluster radius in metres. */
  clusterRadius: number;
  /** Age of the planted trees in years (growth scales sequestration). */
  ageYears: number;
  error: string | null;
}

export const greeningStore = new Store<GreeningState>({
  species: [],
  status: "",
  plantings: [],
  selectedSpecies: "trembesi",
  clusterSize: 20,
  clusterRadius: 60,
  ageYears: 10,
  error: null,
});

const STORAGE_KEY = "dt-airpolution:plantings";

/** Load species once and restore this viewer's saved plantings (localStorage, best effort). */
let loading: Promise<void> | null = null;
export function loadSpecies(url: string): Promise<void> {
  loading ??= fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json() as Promise<{ status: string; species: TreeSpecies[] }>;
    })
    .then(({ status, species }) => {
      let plantings: TreePlanting[] = [];
      try {
        plantings = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
      } catch {
        /* storage unavailable */
      }
      greeningStore.set({ species, status, plantings });
    })
    .catch((err) => greeningStore.set({ error: `Data spesies pohon gagal dimuat: ${err instanceof Error ? err.message : String(err)}` }));
  return loading;
}

greeningStore.on(["plantings"], (s) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s.plantings));
  } catch {
    /* storage unavailable */
  }
});

/** Growth factor 0–1 for a tree of the given age (saturating curve). */
export function growthFactor(ageYears: number, maturityYears: number): number {
  return 1 - Math.exp((-3 * ageYears) / Math.max(1, maturityYears));
}

export interface GreeningTotals {
  trees: number;
  /** t CO₂ / year at the configured age. */
  co2TonnesPerYear: number;
  /** kg PM2.5 / year. */
  pm25KgPerYear: number;
  bySpecies: { species: TreeSpecies; trees: number; co2TonnesPerYear: number }[];
}

export function greeningTotals(s: GreeningState): GreeningTotals {
  const map = new Map<string, number>();
  for (const p of s.plantings) map.set(p.speciesId, (map.get(p.speciesId) ?? 0) + p.count);
  let co2 = 0;
  let pm = 0;
  let trees = 0;
  const bySpecies: GreeningTotals["bySpecies"] = [];
  for (const [id, n] of map) {
    const sp = s.species.find((x) => x.id === id);
    if (!sp) continue;
    const g = growthFactor(s.ageYears, sp.maturityYears);
    const c = (n * sp.co2KgPerYear * g) / 1000;
    co2 += c;
    pm += (n * sp.pm25GramPerYear * g) / 1000;
    trees += n;
    bySpecies.push({ species: sp, trees: n, co2TonnesPerYear: c });
  }
  return { trees, co2TonnesPerYear: co2, pm25KgPerYear: pm, bySpecies };
}
