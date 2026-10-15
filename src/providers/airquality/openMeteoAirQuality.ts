import { isoDate } from "../../core/time";
import type { AirQualityProvider, Pollutant, PollutantSeries } from "../../core/types";
import { alignToAxis, asArray, fetchJson } from "../http";

/**
 * Open-Meteo Air Quality API (Copernicus CAMS global model). Free, no API key,
 * covers past ~2 years plus a 5–7 day forecast in one hourly series.
 * https://open-meteo.com/en/docs/air-quality-api
 *
 * Note: CAMS global has ~0.4° (~45 km) resolution, so neighbouring points in
 * Jakarta often get near-identical values. Station providers (OpenAQ, WAQI)
 * give real spatial variation.
 */

const VARIABLES: Record<Pollutant, string> = {
  pm2_5: "pm2_5",
  pm10: "pm10",
  no2: "nitrogen_dioxide",
  o3: "ozone",
  so2: "sulphur_dioxide",
  co: "carbon_monoxide",
};

interface OpenMeteoAqResponse {
  hourly?: { time: number[] } & Record<string, (number | null)[]>;
}

export const openMeteoAirQuality: AirQualityProvider = {
  id: "open-meteo-aq",
  label: "Open-Meteo Air Quality (CAMS)",
  attribution: "Copernicus Atmosphere Monitoring Service via Open-Meteo.com (CC BY 4.0)",

  async fetch({ locations, range, times, signal }) {
    const params = new URLSearchParams({
      latitude: locations.map((l) => l.latitude.toFixed(4)).join(","),
      longitude: locations.map((l) => l.longitude.toFixed(4)).join(","),
      hourly: Object.values(VARIABLES).join(","),
      timezone: "Asia/Jakarta",
      timeformat: "unixtime",
      start_date: isoDate(range.start),
      end_date: isoDate(range.end),
    });
    const data = asArray(
      await fetchJson<OpenMeteoAqResponse | OpenMeteoAqResponse[]>(
        `https://air-quality-api.open-meteo.com/v1/air-quality?${params}`,
        signal,
      ),
    );

    const out: Record<string, Partial<PollutantSeries>> = {};
    locations.forEach((loc, i) => {
      const hourly = data[i]?.hourly;
      if (!hourly) return;
      const srcTimes = hourly.time.map((s) => s * 1000);
      const series: Partial<PollutantSeries> = {};
      for (const [pollutant, variable] of Object.entries(VARIABLES) as [Pollutant, string][]) {
        if (hourly[variable]) series[pollutant] = alignToAxis(srcTimes, hourly[variable], times);
      }
      out[loc.id] = series;
    });
    return out;
  },
};
