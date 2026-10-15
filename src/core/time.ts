import type { TimeAxis, TimeMode, TimeRange } from "./types";

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const TIME_ZONE = "Asia/Jakarta";

export function floorHour(t: number): number {
  return Math.floor(t / HOUR) * HOUR;
}

export function hourlyAxis(range: TimeRange): TimeAxis {
  const out: number[] = [];
  for (let t = floorHour(range.start); t <= range.end; t += HOUR) out.push(t);
  return out;
}

/** Default window for each mode, relative to `now`. */
export function defaultRange(mode: TimeMode, now = Date.now()): TimeRange {
  const h = floorHour(now);
  switch (mode) {
    case "historical":
      return { start: startOfLocalDay(h - 7 * DAY), end: h };
    case "realtime":
      return { start: h - 48 * HOUR, end: h };
    case "forecast":
      return { start: h, end: h + 5 * DAY };
  }
}

/** Index of the time slot closest to t. */
export function nearestIndex(times: TimeAxis, t: number): number {
  if (!times.length) return 0;
  let best = 0;
  for (let i = 1; i < times.length; i++) {
    if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i;
  }
  return best;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("id-ID", { timeZone: TIME_ZONE, ...options });
    fmtCache.set(key, f);
  }
  return f;
}

export function formatDateTime(t: number): string {
  return `${fmt({ weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(t)} · ${formatTime(t)} WIB`;
}

export function formatTime(t: number): string {
  return fmt({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t).replace(".", ":");
}

export function formatShortDate(t: number): string {
  return fmt({ day: "numeric", month: "short" }).format(t);
}

/** YYYY-MM-DD in Jakarta local time (what Open-Meteo expects with timezone=Asia/Jakarta). */
export function isoDate(t: number): string {
  const parts = fmt({ year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(t);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Parse YYYY-MM-DD as midnight in Jakarta (UTC+7, no DST). */
export function parseIsoDate(value: string): number {
  return Date.parse(`${value}T00:00:00+07:00`);
}

export function startOfLocalDay(t: number): number {
  return parseIsoDate(isoDate(t));
}

const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", hourCycle: "h23" });

/** Hour of day (0–23) in Jakarta. */
export function localHour(t: number): number {
  return Number(hourFmt.format(t)) % 24;
}
