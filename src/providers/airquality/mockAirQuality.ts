import { trafficProfile } from "../../core/profiles";
import type { AirQualityProvider, PollutantSeries } from "../../core/types";
import { isWeekend, localHour, noise, smoothNoise } from "../mockUtils";

/**
 * Synthetic air quality with Jakarta-like patterns: traffic peaks in the
 * morning and evening, a stable night-time inversion, cleaner weekends,
 * photochemical ozone at midday, and fixed per-station offsets.
 * Used only when every real provider fails (or VITE_USE_MOCK_DATA=true).
 */

function sunProfile(hour: number): number {
  return Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
}

export const mockAirQuality: AirQualityProvider = {
  id: "mock-aq",
  label: "Data contoh (sintetis)",
  attribution: "Data sintetis untuk demonstrasi — bukan pengukuran",
  synthetic: true,

  async fetch({ locations, times }) {
    const out: Record<string, PollutantSeries> = {};
    for (const loc of locations) {
      const siteFactor = 0.75 + noise(loc.id) * 0.6;
      const series: PollutantSeries = { pm2_5: [], pm10: [], no2: [], o3: [], so2: [], co: [] };
      for (const t of times) {
        const hour = localHour(t);
        const traffic = trafficProfile(hour) * (isWeekend(t) ? 0.75 : 1);
        const episode = 0.7 + smoothNoise("episode", t) * 0.9; // city-wide multi-day swings
        const local = 0.85 + smoothNoise(loc.id, t) * 0.3;
        const base = siteFactor * traffic * episode * local;
        const pm25 = 22 + 38 * base;
        series.pm2_5.push(round(pm25));
        series.pm10.push(round(pm25 * (1.45 + noise(loc.id, "pm10") * 0.3)));
        series.no2.push(round(18 + 45 * base));
        series.o3.push(round(25 + 95 * sunProfile(hour) * episode * (1.2 - 0.3 * traffic)));
        series.so2.push(round(8 + 14 * base));
        series.co.push(round(450 + 900 * base));
      }
      out[loc.id] = series;
    }
    return out;
  },
};

function round(v: number): number {
  return Math.round(v * 10) / 10;
}
