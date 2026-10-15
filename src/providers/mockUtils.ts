import { HOUR, TIME_ZONE } from "../core/time";

export { localHour } from "../core/time";

/** Deterministic hash → [0, 1) so mock data is stable across reloads. */
export function noise(...keys: (string | number)[]): number {
  let h = 2166136261;
  for (const ch of keys.join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** Smooth noise over time: interpolates hourly random values across 6 h knots. */
export function smoothNoise(seed: string, t: number): number {
  const knot = 6 * HOUR;
  const k = Math.floor(t / knot);
  const f = (t - k * knot) / knot;
  const a = noise(seed, k);
  const b = noise(seed, k + 1);
  return a + (b - a) * (0.5 - Math.cos(f * Math.PI) / 2);
}

const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "short" });

export function isWeekend(t: number): boolean {
  const d = dayFmt.format(t);
  return d === "Sat" || d === "Sun";
}
