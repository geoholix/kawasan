import type { TimeAxis } from "../core/types";

export async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return (await res.json()) as T;
}

/** Re-index a source series (epoch ms) onto the shared hourly axis. Missing slots become null. */
export function alignToAxis(srcTimes: number[], srcValues: (number | null | undefined)[], axis: TimeAxis): (number | null)[] {
  const byTime = new Map<number, number | null>();
  srcTimes.forEach((t, i) => byTime.set(t, srcValues[i] ?? null));
  return axis.map((t) => byTime.get(t) ?? null);
}

/** Open-Meteo returns a single object for one location and an array for several. */
export function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}
