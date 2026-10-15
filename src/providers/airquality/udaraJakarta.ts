import type { AirQualityProvider } from "../../core/types";
import { createJsonRecordsProvider } from "./jsonRecordsProvider";

/**
 * Pengukuran SPKU DLH DKI Jakarta (https://udara.jakarta.go.id).
 *
 * The portal does not document a public API yet, so this adapter is
 * disabled until VITE_UDARA_JAKARTA_URL points at a JSON endpoint (the
 * portal's own data endpoint, a Satu Data Jakarta dataset, or your proxy).
 * Adjust `fields` below to the payload's field names.
 */
export function createUdaraJakartaProvider(url: string | undefined): AirQualityProvider | null {
  if (!url) return null;
  return createJsonRecordsProvider({
    id: "udara-jakarta",
    label: "SPKU DLH DKI Jakarta",
    attribution: "Dinas Lingkungan Hidup Provinsi DKI Jakarta — udara.jakarta.go.id",
    url,
    recordsPath: import.meta.env.VITE_UDARA_JAKARTA_RECORDS_PATH || "data",
    fields: {
      station: "stasiun",
      time: "waktu",
      latitude: "lat",
      longitude: "lon",
      pollutants: { pm2_5: "pm25", pm10: "pm10", no2: "no2", o3: "o3", so2: "so2", co: "co" },
    },
    stationAliases: {
      dki1: ["dki1", "bundaran hi"],
      dki2: ["dki2", "kelapa gading"],
      dki3: ["dki3", "jagakarsa"],
      dki4: ["dki4", "lubang buaya"],
      dki5: ["dki5", "kebon jeruk"],
    },
  });
}
