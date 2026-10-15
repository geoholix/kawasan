import {
  cookingProfile,
  electricityProfile,
  flatProfile,
  profileMean,
  trafficProfile,
} from "../core/profiles";
import { localHour } from "../core/time";

/**
 * Bottom-up CO₂e estimate: activity data × emission factor, per sector and
 * per kota administrasi, with a diurnal profile per sector so the twin can
 * show an hourly emission rate on the timeline. All inputs come from an
 * inventory JSON (public/data/emission-inventory.json) that can be replaced
 * with official data without code changes.
 */

export type Sector = "transport" | "electricity" | "industry" | "residential" | "waste";

export const SECTORS: { id: Sector; label: string }[] = [
  { id: "transport", label: "Transportasi jalan" },
  { id: "electricity", label: "Listrik (grid)" },
  { id: "industry", label: "Industri (gas)" },
  { id: "residential", label: "Rumah tangga (LPG)" },
  { id: "waste", label: "Sampah (TPA)" },
];

/** Categorical slots 1–5 of the validated palette, per theme (adjacent pairs pass CVD checks). */
export const SECTOR_COLORS: Record<"dark" | "light", Record<Sector, string>> = {
  light: { transport: "#2a78d6", electricity: "#eb6834", industry: "#1baf7a", residential: "#eda100", waste: "#e87ba4" },
  dark: { transport: "#3987e5", electricity: "#d95926", industry: "#199e70", residential: "#c98500", waste: "#d55181" },
};

export interface VehicleClass {
  id: string;
  label: string;
  count: number;
  kmPerYear: number;
  kmPerLitre: number;
  fuel: "gasoline" | "diesel";
  evKwhPerKm: number;
}

export interface EmissionZone {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  population: number;
  /** Optional sector shares overriding the population share. */
  shares?: Partial<Record<Sector, number>>;
}

export interface EmissionInventory {
  name: string;
  year: number;
  status: string;
  emissionFactors: {
    gasoline_kgCO2_per_litre: number;
    diesel_kgCO2_per_litre: number;
    grid_tCO2_per_MWh: number;
    naturalGas_kgCO2_per_m3: number;
    lpg_kgCO2_per_kg: number;
    waste_tCO2e_per_tonne: number;
  };
  activity: {
    vehicles: VehicleClass[];
    electricity_MWh: number;
    industryNaturalGas_m3: number;
    residentialLpg_kg: number;
    waste_tonnesPerDay: number;
  };
  zones: EmissionZone[];
}

/** What-if levers, all as fractions 0–1. */
export interface Scenario {
  /** Share of vehicle-km driven electrically, per vehicle class id. */
  evShare: Record<string, number>;
  /** Reduction of vehicle-km (mode shift to transit, WFH, ...). */
  vktReduction: number;
  /** Share of grid electricity from zero-carbon sources (on top of the base grid factor). */
  renewableShare: number;
  /** Reduction of landfilled waste (recycling, composting). */
  wasteReduction: number;
}

export const BASELINE: Scenario = { evShare: {}, vktReduction: 0, renewableShare: 0, wasteReduction: 0 };

export type SectorTotals = Record<Sector, number>;

export interface EmissionResult {
  /** tCO₂e per year per sector, whole city. */
  city: SectorTotals;
  /** tCO₂e per year per sector, per zone id. */
  zones: Record<string, SectorTotals>;
  total: number;
  /** Extra electricity demand from EVs (MWh / year). */
  evMWh: number;
}

const emptyTotals = (): SectorTotals => ({ transport: 0, electricity: 0, industry: 0, residential: 0, waste: 0 });

export function sumTotals(t: SectorTotals): number {
  return SECTORS.reduce((s, x) => s + t[x.id], 0);
}

export function estimate(inv: EmissionInventory, scenario: Scenario = BASELINE): EmissionResult {
  const ef = inv.emissionFactors;
  const a = inv.activity;
  const city = emptyTotals();
  let evMWh = 0;

  for (const v of a.vehicles) {
    const km = v.count * v.kmPerYear * (1 - scenario.vktReduction);
    const ev = scenario.evShare[v.id] ?? 0;
    const litres = (km * (1 - ev)) / v.kmPerLitre;
    const factor = v.fuel === "diesel" ? ef.diesel_kgCO2_per_litre : ef.gasoline_kgCO2_per_litre;
    city.transport += (litres * factor) / 1000;
    evMWh += (km * ev * v.evKwhPerKm) / 1000;
  }
  city.electricity = (a.electricity_MWh + evMWh) * ef.grid_tCO2_per_MWh * (1 - scenario.renewableShare);
  city.industry = (a.industryNaturalGas_m3 * ef.naturalGas_kgCO2_per_m3) / 1000;
  city.residential = (a.residentialLpg_kg * ef.lpg_kgCO2_per_kg) / 1000;
  city.waste = a.waste_tonnesPerDay * 365 * ef.waste_tCO2e_per_tonne * (1 - scenario.wasteReduction);

  const population = inv.zones.reduce((s, z) => s + z.population, 0);
  const zones: Record<string, SectorTotals> = {};
  for (const sector of SECTORS) {
    // Normalise explicit shares so they always sum to 1.
    const raw = inv.zones.map((z) => z.shares?.[sector.id] ?? z.population / population);
    const sum = raw.reduce((s, x) => s + x, 0) || 1;
    inv.zones.forEach((z, i) => {
      (zones[z.id] ??= emptyTotals())[sector.id] = city[sector.id] * (raw[i] / sum);
    });
  }
  return { city, zones, total: sumTotals(city), evMWh };
}

const PROFILES: Record<Sector, (hour: number) => number> = {
  transport: trafficProfile,
  electricity: electricityProfile,
  industry: flatProfile,
  residential: cookingProfile,
  waste: flatProfile,
};
const MEANS = Object.fromEntries(Object.entries(PROFILES).map(([k, p]) => [k, profileMean(p)])) as Record<Sector, number>;

/** Hourly emission rate (tCO₂e / hour) at time t from annual totals. */
export function hourlyRate(annual: SectorTotals, t: number): SectorTotals {
  const hour = localHour(t);
  const out = emptyTotals();
  for (const s of SECTORS) out[s.id] = (annual[s.id] / 8760) * (PROFILES[s.id](hour) / MEANS[s.id]);
  return out;
}

export function formatTonnes(t: number): string {
  if (t >= 1e6) return `${(t / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt t`;
  if (t >= 1e3) return `${(t / 1e3).toLocaleString("id-ID", { maximumFractionDigits: 1 })} rb t`;
  return `${t.toLocaleString("id-ID", { maximumFractionDigits: 0 })} t`;
}
