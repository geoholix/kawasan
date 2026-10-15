import type { IconName } from "../../core/modules";
import type { WeatherCondition } from "../../core/types";

export const CONDITION_LABELS: Record<WeatherCondition, string> = {
  clear: "Cerah",
  "partly-cloudy": "Cerah Berawan",
  cloudy: "Berawan",
  overcast: "Berawan Tebal",
  haze: "Udara Kabur",
  smoke: "Asap",
  fog: "Kabut",
  drizzle: "Hujan Ringan",
  rain: "Hujan",
  "heavy-rain": "Hujan Lebat",
  thunderstorm: "Hujan Petir",
};

/** WMO weather interpretation codes (used by Open-Meteo). */
export function fromWmoCode(code: number | null | undefined): WeatherCondition | null {
  if (code == null) return null;
  if (code === 0) return "clear";
  if (code <= 2) return "partly-cloudy";
  if (code === 3) return "overcast";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code === 65 || code === 67 || code === 82) return "heavy-rain";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 81)) return "rain";
  if (code >= 95) return "thunderstorm";
  return "cloudy";
}

/** BMKG weather codes from the public forecast API. */
export function fromBmkgCode(code: number | null | undefined): WeatherCondition | null {
  switch (code) {
    case 0:
      return "clear";
    case 1:
    case 2:
      return "partly-cloudy";
    case 3:
      return "cloudy";
    case 4:
      return "overcast";
    case 5:
      return "haze";
    case 10:
      return "smoke";
    case 45:
      return "fog";
    case 60:
      return "drizzle";
    case 61:
    case 80:
      return "rain";
    case 63:
      return "heavy-rain";
    case 95:
    case 97:
      return "thunderstorm";
    default:
      return code == null ? null : "cloudy";
  }
}

export function conditionIcon(condition: WeatherCondition | null): IconName {
  switch (condition) {
    case "clear":
      return "brightness";
    case "partly-cloudy":
    case "cloudy":
    case "overcast":
      return "cloud";
    case "haze":
    case "smoke":
    case "fog":
      return "fog";
    case "drizzle":
    case "rain":
    case "heavy-rain":
      return "rain";
    case "thunderstorm":
      return "rain-thunder";
    default:
      return "question";
  }
}

const COMPASS = ["U", "TL", "T", "TG", "S", "BD", "B", "BL"];

/** Indonesian 8-point compass label for a "from" direction (U = utara, T = timur, ...). */
export function compassLabel(deg: number | null | undefined): string {
  if (deg == null) return "–";
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
