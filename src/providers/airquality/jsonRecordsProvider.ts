import { floorHour } from "../../core/time";
import type { AirQualityProvider, MonitoringStation, Pollutant, PollutantSeries } from "../../core/types";
import { fetchJson } from "../http";

/**
 * Generic adapter for station APIs that return a flat list of measurement
 * records, e.g. `[{ "stasiun": "DKI1", "waktu": "...", "pm25": 41 }, ...]`.
 * Point it at any JSON endpoint by describing the field names; no new code
 * needed. Records are matched to configured stations by name alias, or by
 * the nearest station when the record carries coordinates.
 */
export interface JsonRecordsOptions {
  id: string;
  label: string;
  attribution: string;
  /** Endpoint URL. `{start}` and `{end}` are replaced with ISO timestamps. */
  url: string;
  /** Dot path of the record array inside the response, e.g. "data.items". Empty = response root. */
  recordsPath?: string;
  fields: {
    station: string;
    time: string;
    latitude?: string;
    longitude?: string;
    pollutants: Partial<Record<Pollutant, string>>;
  };
  /** Map of configured station id → names used by the API for that station. */
  stationAliases?: Record<string, string[]>;
  /** Max distance (km) for coordinate matching. */
  maxMatchDistanceKm?: number;
}

function at(obj: unknown, path: string | undefined): unknown {
  if (!path) return obj;
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function toNumber(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dx = (aLon - bLon) * 111.32 * Math.cos((aLat * Math.PI) / 180);
  const dy = (aLat - bLat) * 110.57;
  return Math.hypot(dx, dy);
}

export function createJsonRecordsProvider(options: JsonRecordsOptions): AirQualityProvider {
  const matchStation = (record: unknown, stations: MonitoringStation[]): MonitoringStation | null => {
    const name = String(at(record, options.fields.station) ?? "").toLowerCase();
    for (const s of stations) {
      const aliases = [s.id, s.name, ...(options.stationAliases?.[s.id] ?? [])].map((a) => a.toLowerCase());
      if (name && aliases.some((a) => name === a || name.includes(a))) return s;
    }
    const lat = toNumber(at(record, options.fields.latitude ?? ""));
    const lon = toNumber(at(record, options.fields.longitude ?? ""));
    if (lat == null || lon == null) return null;
    let best: MonitoringStation | null = null;
    let bestD = options.maxMatchDistanceKm ?? 3;
    for (const s of stations) {
      const d = distanceKm(lat, lon, s.latitude, s.longitude);
      if (d <= bestD) [best, bestD] = [s, d];
    }
    return best;
  };

  return {
    id: options.id,
    label: options.label,
    attribution: options.attribution,
    async fetch({ locations, range, times, signal }) {
      const url = options.url
        .replace("{start}", encodeURIComponent(new Date(range.start).toISOString()))
        .replace("{end}", encodeURIComponent(new Date(range.end).toISOString()));
      const json = await fetchJson<unknown>(url, signal);
      const records = at(json, options.recordsPath);
      if (!Array.isArray(records)) throw new Error(`${options.id}: response has no record array at "${options.recordsPath ?? ""}"`);

      const indexOf = new Map(times.map((t, i) => [t, i]));
      const out: Record<string, Partial<PollutantSeries>> = {};
      for (const record of records) {
        const station = matchStation(record, locations);
        const t = Date.parse(String(at(record, options.fields.time) ?? ""));
        const k = Number.isFinite(t) ? indexOf.get(floorHour(t)) : undefined;
        if (!station || k == null) continue;
        const series = (out[station.id] ??= {});
        for (const [pollutant, field] of Object.entries(options.fields.pollutants) as [Pollutant, string][]) {
          const value = toNumber(at(record, field));
          if (value == null) continue;
          (series[pollutant] ??= times.map(() => null))[k] = value;
        }
      }
      return out;
    },
  };
}
