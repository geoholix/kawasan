import { DAY, isoDate } from "../../core/time";
import type { WeatherProvider, WeatherSample } from "../../core/types";
import { alignToAxis, asArray, fetchJson } from "../http";
import { CONDITION_LABELS, fromWmoCode } from "./conditions";

/**
 * Open-Meteo weather: hourly series for any past or future window. Used for
 * history (BMKG's public API only publishes forecasts) and as a fallback
 * for the forecast.
 * - last ~90 days + 16-day forecast: /v1/forecast
 * - older: /v1/archive (ERA5 reanalysis, ~5 day delay)
 */

interface Hourly {
  time: number[];
  [variable: string]: (number | null)[];
}

const RECENT_WINDOW = 90 * DAY;

export const openMeteoWeather: WeatherProvider = {
  id: "open-meteo-weather",
  label: "Open-Meteo Weather",
  attribution: "Weather data by Open-Meteo.com (CC BY 4.0)",

  async fetch({ locations, range, times, signal }) {
    const recent = range.start >= Date.now() - RECENT_WINDOW;
    const variables = [
      "temperature_2m",
      "relative_humidity_2m",
      "wind_speed_10m",
      "wind_direction_10m",
      "cloud_cover",
      "precipitation",
      "weather_code",
      ...(recent ? ["visibility", "boundary_layer_height"] : []),
    ];
    const params = new URLSearchParams({
      latitude: locations.map((l) => l.latitude.toFixed(4)).join(","),
      longitude: locations.map((l) => l.longitude.toFixed(4)).join(","),
      hourly: variables.join(","),
      wind_speed_unit: "ms",
      timezone: "Asia/Jakarta",
      timeformat: "unixtime",
      start_date: isoDate(range.start),
      end_date: isoDate(range.end),
    });
    const base = recent ? "https://api.open-meteo.com/v1/forecast" : "https://archive-api.open-meteo.com/v1/archive";
    const data = asArray(await fetchJson<{ hourly?: Hourly } | { hourly?: Hourly }[]>(`${base}?${params}`, signal));

    const out: Record<string, (WeatherSample | null)[]> = {};
    locations.forEach((loc, i) => {
      const hourly = data[i]?.hourly;
      if (!hourly) return;
      const src = hourly.time.map((s) => s * 1000);
      const col = (name: string) => (hourly[name] ? alignToAxis(src, hourly[name], times) : times.map(() => null));
      const [temp, hum, ws, wd, cc, pr, code, vis, blh] = [
        "temperature_2m",
        "relative_humidity_2m",
        "wind_speed_10m",
        "wind_direction_10m",
        "cloud_cover",
        "precipitation",
        "weather_code",
        "visibility",
        "boundary_layer_height",
      ].map(col);
      out[loc.id] = times.map((_, k) => {
        if (temp[k] == null && ws[k] == null) return null;
        const condition = fromWmoCode(code[k]);
        return {
          temperature: temp[k],
          humidity: hum[k],
          windSpeed: ws[k],
          windDirection: wd[k],
          cloudCover: cc[k],
          precipitation: pr[k],
          boundaryLayerHeight: blh[k],
          visibility: vis[k],
          condition,
          description: condition ? CONDITION_LABELS[condition] : null,
        };
      });
    });
    return out;
  },
};
