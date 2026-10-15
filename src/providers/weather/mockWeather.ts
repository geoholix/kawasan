import type { WeatherProvider, WeatherSample } from "../../core/types";
import { localHour, noise, smoothNoise } from "../mockUtils";
import { CONDITION_LABELS } from "./conditions";

/** Synthetic tropical weather: warm afternoons, sea breeze from the north, afternoon showers. */
export const mockWeather: WeatherProvider = {
  id: "mock-weather",
  label: "Cuaca contoh (sintetis)",
  attribution: "Data sintetis untuk demonstrasi — bukan pengukuran",
  synthetic: true,

  async fetch({ locations, times }) {
    const out: Record<string, (WeatherSample | null)[]> = {};
    for (const loc of locations) {
      out[loc.id] = times.map((t) => {
        const hour = localHour(t);
        const day = Math.sin(((hour - 8) / 24) * 2 * Math.PI);
        const seaBreeze = hour >= 10 && hour <= 18;
        const wet = smoothNoise("rain", t);
        const cloud = Math.min(100, Math.round(25 + wet * 70 + (hour >= 13 && hour <= 17 ? 15 : 0)));
        const rain = wet > 0.78 && hour >= 13 && hour <= 20 ? Math.round((wet - 0.78) * 40 * 10) / 10 : 0;
        const condition = rain > 4 ? "heavy-rain" : rain > 0 ? "rain" : cloud > 80 ? "overcast" : cloud > 55 ? "cloudy" : cloud > 25 ? "partly-cloudy" : "clear";
        return {
          temperature: Math.round((28.5 + 3.8 * day + (noise(loc.id) - 0.5)) * 10) / 10,
          humidity: Math.round(74 - 14 * day + wet * 8),
          windSpeed: Math.round((1.2 + (seaBreeze ? 2.6 : 0.8) * (0.6 + smoothNoise(`ws${loc.id}`, t) * 0.8)) * 10) / 10,
          windDirection: Math.round((seaBreeze ? 10 : 120) + (smoothNoise("wd", t) - 0.5) * 70 + 360) % 360,
          cloudCover: cloud,
          precipitation: rain,
          boundaryLayerHeight: Math.round(250 + 1200 * Math.max(0, Math.sin(((hour - 7) / 12) * Math.PI))),
          visibility: Math.round(4000 + 6000 * (1 - wet * 0.5)),
          condition,
          description: CONDITION_LABELS[condition],
        };
      });
    }
    return out;
  },
};
