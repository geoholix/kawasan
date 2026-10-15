import { HOUR } from "../../core/time";
import type { BmkgRegionForecast, BmkgSlot, WeatherLocation, WeatherProvider, WeatherSample } from "../../core/types";
import { fetchJson } from "../http";
import { fromBmkgCode } from "./conditions";

/**
 * BMKG public weather forecast (prakiraan cuaca), 3-hourly for 3 days, per
 * kelurahan (adm4 code). https://data.bmkg.go.id/prakiraan-cuaca/
 * Limit: 60 requests / minute / IP. Attribution to BMKG is required.
 */

interface BmkgRawSlot {
  datetime?: string;
  utc_datetime?: string;
  local_datetime?: string;
  t?: number;
  hu?: number;
  ws?: number; // km/h
  wd_deg?: number;
  tcc?: number;
  tp?: number;
  vs?: number;
  weather?: number;
  weather_desc?: string;
  image?: string;
  analysis_date?: string;
}

interface BmkgRawResponse {
  lokasi?: { desa?: string; kecamatan?: string; kotkab?: string };
  data?: { lokasi?: { desa?: string; kecamatan?: string; kotkab?: string }; cuaca?: BmkgRawSlot[][] }[];
}

const SLOT_LENGTH = 3 * HOUR;
const CACHE_TTL = 30 * 60_000;

let baseUrl = "https://api.bmkg.go.id";
let cache: { at: number; key: string; data: Promise<BmkgRegionForecast[]> } | null = null;

export function configureBmkg(url: string): void {
  baseUrl = url.replace(/\/$/, "");
}

function parseTime(slot: BmkgRawSlot): number {
  if (slot.datetime) return Date.parse(slot.datetime);
  if (slot.utc_datetime) return Date.parse(`${slot.utc_datetime.replace(" ", "T")}Z`);
  return Number.NaN;
}

function toSample(slot: BmkgRawSlot): WeatherSample {
  return {
    temperature: slot.t ?? null,
    humidity: slot.hu ?? null,
    windSpeed: slot.ws != null ? slot.ws / 3.6 : null,
    windDirection: slot.wd_deg ?? null,
    cloudCover: slot.tcc ?? null,
    precipitation: slot.tp ?? null,
    boundaryLayerHeight: null,
    visibility: slot.vs ?? null,
    condition: fromBmkgCode(slot.weather),
    description: slot.weather_desc ?? null,
  };
}

async function fetchRegion(location: WeatherLocation, signal?: AbortSignal): Promise<BmkgRegionForecast> {
  const raw = await fetchJson<BmkgRawResponse>(
    `${baseUrl}/publik/prakiraan-cuaca?adm4=${encodeURIComponent(location.adm4 ?? "")}`,
    signal,
  );
  const entry = raw.data?.[0];
  const names = entry?.lokasi ?? raw.lokasi ?? {};
  const slots: BmkgSlot[] = (entry?.cuaca ?? [])
    .flat()
    .map((s) => ({ time: parseTime(s), localTime: s.local_datetime ?? "", sample: toSample(s), iconUrl: s.image ?? null }))
    .filter((s) => Number.isFinite(s.time))
    .sort((a, b) => a.time - b.time);
  const firstRaw = entry?.cuaca?.[0]?.[0];
  return {
    location,
    village: names.desa ?? null,
    district: names.kecamatan ?? null,
    city: names.kotkab ?? null,
    analysisDate: firstRaw?.analysis_date ?? null,
    slots,
  };
}

/** Fetch (cached) BMKG forecasts for every location that has an adm4 code. Failed regions are skipped. */
export function fetchBmkgForecasts(locations: WeatherLocation[], signal?: AbortSignal): Promise<BmkgRegionForecast[]> {
  const key = locations.map((l) => l.adm4).join(",");
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_TTL) return cache.data;
  const data = Promise.allSettled(locations.filter((l) => l.adm4).map((l) => fetchRegion(l, signal))).then((results) => {
    const ok = results.flatMap((r) => (r.status === "fulfilled" && r.value.slots.length ? [r.value] : []));
    if (!ok.length) {
      const reason = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
      throw new Error(`BMKG tidak dapat diakses${reason ? `: ${String(reason.reason?.message ?? reason.reason)}` : ""}`);
    }
    return ok;
  });
  cache = { at: Date.now(), key, data };
  data.catch(() => {
    if (cache?.data === data) cache = null;
  });
  return data;
}

/** Slot covering time t (each BMKG slot represents the following 3 hours). */
export function slotAt(forecast: BmkgRegionForecast, t: number): BmkgSlot | null {
  for (let i = forecast.slots.length - 1; i >= 0; i--) {
    const slot = forecast.slots[i];
    if (slot.time <= t) return t < slot.time + SLOT_LENGTH ? slot : null;
  }
  return null;
}

export const bmkgForecast: WeatherProvider = {
  id: "bmkg",
  label: "BMKG Prakiraan Cuaca",
  attribution: "Sumber: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)",

  async fetch({ locations, times, signal }) {
    const forecasts = await fetchBmkgForecasts(locations, signal);
    const out: Record<string, (WeatherSample | null)[]> = {};
    for (const fc of forecasts) {
      out[fc.location.id] = times.map((t) => slotAt(fc, t)?.sample ?? null);
    }
    return out;
  },
};
