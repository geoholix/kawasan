import type { AirQualityProvider, Pollutant, PollutantSeries } from "../../core/types";
import { fetchJson } from "../http";

/**
 * Reads the static archive written by scripts/collect-archive.mjs
 * (public/data/archive/YYYY-MM.json, hourly arrays per station, UTC months).
 * Only months listed in index.json are requested, so an empty archive costs
 * a single small request and no 404s.
 */

const HOUR = 3_600_000;

interface ArchiveIndex {
  months: string[];
}

interface ArchiveMonth {
  start: number;
  stations: Record<string, Partial<Record<Pollutant, (number | null)[]>>>;
}

export function createArchiveProvider(baseUrl: string): AirQualityProvider {
  let index: Promise<ArchiveIndex | null> | null = null;
  const months = new Map<string, Promise<ArchiveMonth>>();

  const loadIndex = (signal?: AbortSignal) =>
    (index ??= fetchJson<ArchiveIndex>(`${baseUrl}/index.json`, signal).catch(() => {
      index = null; // retry on next load; no archive is not an error
      return null;
    }));
  const loadMonth = (key: string, signal?: AbortSignal) => {
    let m = months.get(key);
    if (!m) {
      m = fetchJson<ArchiveMonth>(`${baseUrl}/${key}.json`, signal);
      months.set(key, m);
      m.catch(() => months.delete(key));
    }
    return m;
  };

  return {
    id: "archive",
    label: "Arsip data (dikumpulkan terjadwal)",
    attribution: "Arsip snapshot Open-Meteo / CAMS (CC BY 4.0), dikumpulkan lewat GitHub Actions",
    async fetch({ locations, times, signal }) {
      const available = (await loadIndex(signal))?.months;
      if (!available?.length) return {};
      const wanted = new Set(times.map((t) => new Date(t).toISOString().slice(0, 7)));
      const files = await Promise.all(available.filter((k) => wanted.has(k)).map((k) => loadMonth(k, signal)));

      const out: Record<string, Partial<PollutantSeries>> = {};
      for (const loc of locations) {
        for (const file of files) {
          const stored = file.stations[loc.id];
          if (!stored) continue;
          for (const [pollutant, values] of Object.entries(stored) as [Pollutant, (number | null)[]][]) {
            const series = ((out[loc.id] ??= {})[pollutant] ??= times.map(() => null));
            times.forEach((t, i) => {
              const v = values[(t - file.start) / HOUR];
              if (v != null) series[i] = v;
            });
          }
        }
      }
      return out;
    },
  };
}
