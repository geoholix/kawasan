import type SunLighting from "@arcgis/core/views/3d/environment/SunLighting";
import type { LayerModule } from "../core/modules";
import { average, cityWeather, readingsAt } from "../core/selectors";
import type { WeatherSample } from "../core/types";

type WeatherSetting =
  | { type: "sunny"; cloudCover: number }
  | { type: "cloudy"; cloudCover: number }
  | { type: "rainy"; cloudCover: number; precipitation: number }
  | { type: "foggy"; fogStrength: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Maps the twin's state onto the SceneView environment: sun position follows
 * the timeline, rain/cloud follow the weather, and PM2.5 drives haze (fog).
 * Weather effects are only rendered by the SDK near the ground.
 */
export function weatherFor(weather: WeatherSample | null, pm25: number | null): WeatherSetting {
  const cc = clamp((weather?.cloudCover ?? 30) / 100, 0, 1);
  switch (weather?.condition) {
    case "thunderstorm":
    case "heavy-rain":
      return { type: "rainy", cloudCover: 0.9, precipitation: 0.9 };
    case "rain":
      return { type: "rainy", cloudCover: 0.8, precipitation: 0.5 };
    case "drizzle":
      return { type: "rainy", cloudCover: 0.7, precipitation: 0.2 };
  }
  const hazy = weather?.condition === "fog" || weather?.condition === "haze" || weather?.condition === "smoke";
  if (hazy || (pm25 ?? 0) > 55) {
    return { type: "foggy", fogStrength: round1(clamp(((pm25 ?? 60) - 25) / 150, 0.1, 0.8)) };
  }
  if (cc > 0.6) return { type: "cloudy", cloudCover: round1(cc) };
  return { type: "sunny", cloudCover: round1(cc) };
}

/** Fixed daylight used when time-of-day lighting is off: 12:00 WIB (05:00 UTC) of the timeline's day. */
function noonOf(t: number): Date {
  const d = new Date(t);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours() >= 17 ? 29 : 5));
}

/**
 * Two independent switches share the SceneView environment:
 *  - "atmosphere": rain/cloud/haze effects from weather and PM2.5
 *  - "daylight": sun position follows the timeline (dark at night); off = fixed midday light
 * Both default to off so the scene opens bright and unobstructed.
 */
export function createAtmosphereLayers(): LayerModule[] {
  let weatherOn = false;
  let timeOn = false;
  let update: () => void = () => {};

  const atmosphere: LayerModule = {
    id: "atmosphere",
    title: "Atmosfer (cuaca & kabut)",
    description: "Hujan/awan dari data cuaca; kabut dari PM2.5. Efek cuaca tampil saat kamera dekat permukaan.",
    visibleByDefault: false,

    init({ view, store }) {
      let lastKey = "";
      view.environment.lighting = { type: "sun", directShadowsEnabled: true, cameraTrackingEnabled: false };

      update = () => {
        const s = store.state;
        const t = s.airQuality?.times[s.timeIndex] ?? Date.now();
        (view.environment.lighting as SunLighting).date = timeOn ? new Date(t) : noonOf(t);
        const setting: WeatherSetting = weatherOn
          ? weatherFor(cityWeather(s), average(readingsAt(s).map((r) => r.concentrations.pm2_5 ?? null)))
          : { type: "sunny", cloudCover: 0.2 };
        const key = JSON.stringify(setting);
        if (key !== lastKey) {
          lastKey = key;
          view.environment.weather = setting;
        }
      };
      store.on(["airQuality", "weather", "timeIndex"], () => update(), true);
    },

    setVisible(visible) {
      weatherOn = visible;
      update();
    },
  };

  const daylight: LayerModule = {
    id: "daylight",
    title: "Pencahayaan mengikuti waktu",
    description: "Matahari & bayangan mengikuti jam di timeline (gelap saat malam). Mati = cahaya siang tetap.",
    visibleByDefault: false,
    init() {},
    setVisible(visible) {
      timeOn = visible;
      update();
    },
  };

  return [atmosphere, daylight];
}
