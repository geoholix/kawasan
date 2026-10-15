import { categoryOf, ispu, POLLUTANTS, subIndex } from "./ispu";
import type { AppState } from "./store";
import type { Indicator, Pollutant, WeatherSample } from "./types";

export interface StationReading {
  stationId: string;
  concentrations: Partial<Record<Pollutant, number | null>>;
  ispu: number | null;
  dominant: Pollutant | null;
  /** Value of the active indicator (concentration, or ISPU). */
  value: number | null;
  /** ISPU sub-index of the active indicator, used for colour. */
  index: number | null;
}

/** Readings of every station at the active time step. */
export function readingsAt(state: AppState, timeIndex = state.timeIndex): StationReading[] {
  const aq = state.airQuality;
  if (!aq) return [];
  return Object.entries(aq.stations).map(([stationId, series]) => {
    const concentrations: Partial<Record<Pollutant, number | null>> = {};
    for (const p of POLLUTANTS) concentrations[p] = series[p][timeIndex] ?? null;
    const total = ispu(concentrations);
    const value = state.indicator === "ispu" ? total.value : concentrations[state.indicator] ?? null;
    const index = state.indicator === "ispu" ? total.value : subIndex(state.indicator, value);
    return { stationId, concentrations, ispu: total.value, dominant: total.dominant, value, index };
  });
}

/** Full time series of one indicator for one station. */
export function indicatorSeries(state: AppState, stationId: string, indicator: Indicator = state.indicator): (number | null)[] {
  const series = state.airQuality?.stations[stationId];
  if (!series) return [];
  if (indicator !== "ispu") return series[indicator];
  return state.airQuality!.times.map((_, k) => {
    const c: Partial<Record<Pollutant, number | null>> = {};
    for (const p of POLLUTANTS) c[p] = series[p][k];
    return ispu(c).value;
  });
}

export function average(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export interface CitySummary {
  value: number | null;
  index: number | null;
  category: ReturnType<typeof categoryOf>;
  dominant: Pollutant | null;
  worst: StationReading | null;
  best: StationReading | null;
}

export function citySummary(state: AppState): CitySummary {
  const readings = readingsAt(state);
  const valid = readings.filter((r) => r.index != null);
  const value = average(readings.map((r) => r.value));
  const index = average(readings.map((r) => r.index));
  const dominantCounts = new Map<Pollutant, number>();
  readings.forEach((r) => r.dominant && dominantCounts.set(r.dominant, (dominantCounts.get(r.dominant) ?? 0) + 1));
  const dominant = [...dominantCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const sorted = [...valid].sort((a, b) => b.index! - a.index!);
  return {
    value,
    index: index == null ? null : Math.round(index),
    category: categoryOf(index),
    dominant,
    worst: sorted[0] ?? null,
    best: sorted[sorted.length - 1] ?? null,
  };
}

/** Weather of every location at the active time step. */
export function weatherAt(state: AppState, timeIndex = state.timeIndex): Record<string, WeatherSample | null> {
  const out: Record<string, WeatherSample | null> = {};
  const w = state.weather;
  if (!w) return out;
  for (const [id, series] of Object.entries(w.locations)) out[id] = series[timeIndex] ?? null;
  return out;
}

/** City-wide weather: averages of numeric fields, most frequent condition. */
export function cityWeather(state: AppState): WeatherSample | null {
  const samples = Object.values(weatherAt(state)).filter((s): s is WeatherSample => !!s);
  if (!samples.length) return null;
  const avg = (key: keyof WeatherSample) => average(samples.map((s) => s[key] as number | null));
  // Wind direction must be averaged as a vector.
  let u = 0;
  let v = 0;
  for (const s of samples) {
    if (s.windDirection == null || s.windSpeed == null) continue;
    const rad = (s.windDirection * Math.PI) / 180;
    u += Math.sin(rad) * s.windSpeed;
    v += Math.cos(rad) * s.windSpeed;
  }
  const counts = new Map<string, number>();
  samples.forEach((s) => s.condition && counts.set(s.condition, (counts.get(s.condition) ?? 0) + 1));
  const condition = ([...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null) as WeatherSample["condition"];
  return {
    temperature: avg("temperature"),
    humidity: avg("humidity"),
    windSpeed: avg("windSpeed"),
    windDirection: u || v ? ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360 : null,
    cloudCover: avg("cloudCover"),
    precipitation: avg("precipitation"),
    boundaryLayerHeight: avg("boundaryLayerHeight"),
    visibility: avg("visibility"),
    condition,
    description: samples.find((s) => s.condition === condition)?.description ?? null,
  };
}
