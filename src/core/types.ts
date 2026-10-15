/**
 * Shared domain types. Every provider, layer and widget speaks in these
 * shapes, so new data sources only need to map their payload onto them.
 */

export type Pollutant = "pm2_5" | "pm10" | "no2" | "o3" | "so2" | "co";

/** What the map and charts are currently showing: one pollutant, or the ISPU index (max sub-index). */
export type Indicator = Pollutant | "ispu";

export type TimeMode = "historical" | "realtime" | "forecast";

export interface GeoLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface MonitoringStation extends GeoLocation {
  /** "spku" = KLHK/DLH monitoring station, "embassy" = US Embassy monitor, "model" = virtual point sampled from a model. */
  kind: "spku" | "embassy" | "model";
  /** Short label shown on the 3D map. */
  shortName: string;
  district?: string;
}

export interface WeatherLocation extends GeoLocation {
  /** BMKG administrative code (kode wilayah tingkat IV / kelurahan). */
  adm4?: string;
}

/** Hourly UTC epoch milliseconds shared by every series in a dataset. */
export type TimeAxis = number[];

export type PollutantSeries = Record<Pollutant, (number | null)[]>;

export interface AirQualityDataset {
  times: TimeAxis;
  /** Values per station id. Concentrations in µg/m³ (CO included). */
  stations: Record<string, PollutantSeries>;
  /** Provider ids that contributed values. */
  sources: string[];
  /** True when the values are synthetic (mock fallback). */
  synthetic: boolean;
}

export type WeatherCondition =
  | "clear"
  | "partly-cloudy"
  | "cloudy"
  | "overcast"
  | "haze"
  | "smoke"
  | "fog"
  | "drizzle"
  | "rain"
  | "heavy-rain"
  | "thunderstorm";

export interface WeatherSample {
  /** °C */
  temperature: number | null;
  /** % */
  humidity: number | null;
  /** m/s */
  windSpeed: number | null;
  /** Meteorological degrees: direction the wind blows FROM. */
  windDirection: number | null;
  /** % */
  cloudCover: number | null;
  /** mm in the hour (or interval for BMKG) */
  precipitation: number | null;
  /** Planetary boundary layer height in m — low PBL traps pollutants near the ground. */
  boundaryLayerHeight: number | null;
  /** m */
  visibility: number | null;
  condition: WeatherCondition | null;
  description: string | null;
}

export interface WeatherDataset {
  times: TimeAxis;
  locations: Record<string, (WeatherSample | null)[]>;
  sources: string[];
  synthetic: boolean;
}

/** One raw BMKG forecast slot, kept for the BMKG widget. */
export interface BmkgSlot {
  time: number;
  localTime: string;
  sample: WeatherSample;
  iconUrl: string | null;
}

export interface BmkgRegionForecast {
  location: WeatherLocation;
  /** Kelurahan / kecamatan / kota names reported by BMKG. */
  village: string | null;
  district: string | null;
  city: string | null;
  analysisDate: string | null;
  slots: BmkgSlot[];
}

export interface TimeRange {
  start: number;
  end: number;
}

/** Request every data provider receives. */
export interface ProviderRequest<L extends GeoLocation = GeoLocation> {
  times: TimeAxis;
  range: TimeRange;
  locations: L[];
  signal?: AbortSignal;
}

export interface AirQualityProvider {
  id: string;
  label: string;
  attribution: string;
  /** Synthetic providers are only used when every real provider fails. */
  synthetic?: boolean;
  fetch(request: ProviderRequest<MonitoringStation>): Promise<Record<string, Partial<PollutantSeries>>>;
}

export interface WeatherProvider {
  id: string;
  label: string;
  attribution: string;
  synthetic?: boolean;
  fetch(request: ProviderRequest<WeatherLocation>): Promise<Record<string, (WeatherSample | null)[]>>;
}
