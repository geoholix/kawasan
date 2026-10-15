/**
 * Runtime configuration: public/config.json is fetched when the app starts and applied on top of
 * the defaults in config/app.config.ts and config.ts. It is copied unchanged into dist/, so a
 * deployed app can be reconfigured by editing that file, no rebuild needed. The JSON Schema in
 * public/config.schema.json documents every field (editors show it as hover help).
 *
 * Invalid values are reported in the console and replaced by the default; a missing or broken
 * file falls back to the defaults entirely.
 */
import type { Indicator, MonitoringStation, TimeMode, WeatherLocation } from "../core/types";
import { areas, config as kawasan, type Area } from "../config";
import { appConfig, type BuildingSource } from "./app.config";

export const CONFIG_URL = "./config.json";

const INDICATORS: Indicator[] = ["pm2_5", "pm10", "no2", "o3", "so2", "co", "ispu"];
const TIME_MODES: TimeMode[] = ["historical", "realtime", "forecast"];

/** Settings read by main.ts (the rest is applied straight onto appConfig / kawasan config). */
export interface StartupSettings {
  theme: "auto" | "dark" | "light";
  viewMode: "3d" | "2d";
  timeMode: TimeMode;
  indicator: Indicator;
  speed: number;
  /** Layer module id → visible on start. Ids not listed keep the module default. */
  layers: Record<string, boolean>;
  /** Widget ids to show; null = all registered widgets. */
  widgets: string[] | null;
  /** Start panel opened on start ("" = none, null = the registry default). */
  openWidget: string | null;
  timelineDock: boolean;
}

export const startup: StartupSettings = {
  theme: "auto",
  viewMode: "3d",
  timeMode: "historical",
  indicator: "pm2_5",
  speed: 4,
  layers: {},
  widgets: null,
  openWidget: null,
  timelineDock: true,
};

type Json = Record<string, unknown>;
const problems: string[] = [];
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isNumTuple = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every(isNum);

/** Reads `src[key]` if it passes `check`, otherwise reports it and returns undefined. */
function read<T>(src: Json, key: string, path: string, check: (v: unknown) => v is T, expected: string): T | undefined {
  if (!(key in src)) return undefined;
  const v = src[key];
  if (check(v)) return v;
  problems.push(`${path}.${key}: harus ${expected}`);
  return undefined;
}
const oneOf = <T extends string>(values: readonly T[]) => (v: unknown): v is T => isStr(v) && (values as readonly string[]).includes(v);
const section = (src: Json, key: string): Json | undefined => read(src, key, "config", isObj, "objek");

const isCamera = (v: unknown): v is AppCamera =>
  isObj(v) && ["longitude", "latitude", "z", "heading", "tilt"].every((k) => isNum(v[k]));
type AppCamera = typeof appConfig.camera;

const isArea = (v: unknown): v is Area =>
  isObj(v) &&
  isStr(v.id) &&
  isStr(v.name) &&
  isNumTuple(v.center, 2) &&
  isNumTuple(v.extent, 4) &&
  isObj(v.camera) &&
  ["offsetLat", "z", "tilt", "heading"].every((k) => isNum((v.camera as Json)[k]));

const isStation = (v: unknown): v is MonitoringStation =>
  isObj(v) && isStr(v.id) && isStr(v.name) && isStr(v.shortName) && oneOf(["spku", "embassy", "model"] as const)(v.kind) && isNum(v.latitude) && isNum(v.longitude);
const isWeatherLocation = (v: unknown): v is WeatherLocation =>
  isObj(v) && isStr(v.id) && isStr(v.name) && isNum(v.latitude) && isNum(v.longitude);
const isBuildingSource = (v: unknown): v is BuildingSource =>
  isObj(v) &&
  ((v.type === "basemap") ||
    (v.type === "portal-item" && isStr(v.id)) ||
    (v.type === "scene-service" && isStr(v.url)) ||
    (v.type === "geojson" && isStr(v.url) && isStr(v.heightField)));
const arrayOf = <T>(check: (v: unknown) => v is T) => (v: unknown): v is T[] => Array.isArray(v) && v.length > 0 && v.every(check);
const boolMap = (v: unknown): v is Record<string, boolean> => isObj(v) && Object.values(v).every(isBool);

const SECTIONS = ["$schema", "app", "camera", "kawasan", "time", "layers", "widgets", "basemaps", "buildings", "buildingsFallback", "stations", "weatherLocations", "data", "assistant"];

function apply(raw: Json): void {
  for (const key of Object.keys(raw)) if (!SECTIONS.includes(key)) problems.push(`config.${key}: bagian tidak dikenal (salah ketik?)`);
  const app = section(raw, "app");
  if (app) {
    const title = read(app, "title", "app", isStr, "teks");
    if (title) appConfig.title = title;
    const subtitle = read(app, "subtitle", "app", isStr, "teks");
    if (subtitle !== undefined) appConfig.subtitle = subtitle;
    startup.theme = read(app, "theme", "app", oneOf(["auto", "dark", "light"] as const), '"auto", "dark" atau "light"') ?? startup.theme;
    startup.viewMode = read(app, "viewMode", "app", oneOf(["3d", "2d"] as const), '"3d" atau "2d"') ?? startup.viewMode;
  }

  const camera = read(raw, "camera", "config", isCamera, "objek { longitude, latitude, z, heading, tilt }");
  if (camera) appConfig.camera = camera;

  const k = section(raw, "kawasan");
  if (k) {
    kawasan.webmapId = read(k, "webmapId", "kawasan", isStr, "teks") ?? kawasan.webmapId;
    kawasan.portalUrl = read(k, "portalUrl", "kawasan", isStr, "URL") ?? kawasan.portalUrl;
    kawasan.clientId = read(k, "oauthClientId", "kawasan", isStr, "teks") || kawasan.clientId;
    kawasan.fallbackBasemap2d = read(k, "fallbackBasemap2d", "kawasan", isStr, "id basemap") ?? kawasan.fallbackBasemap2d;
    kawasan.layerOffset3d = read(k, "layerOffset3d", "kawasan", isNum, "angka (meter)") ?? kawasan.layerOffset3d;
    kawasan.webmapLayers = read(k, "webmapLayers", "kawasan", boolMap, "objek { judul layer: true/false }") ?? kawasan.webmapLayers;
    const list = read(k, "areas", "kawasan", arrayOf(isArea), "daftar kawasan { id, name, center, extent, camera }");
    if (list) areas.splice(0, areas.length, ...list.map((a) => ({ ...a, description: a.description ?? "" })));
  }

  const time = section(raw, "time");
  if (time) {
    startup.timeMode = read(time, "mode", "time", oneOf(TIME_MODES), TIME_MODES.join(" / ")) ?? startup.timeMode;
    startup.indicator = read(time, "indicator", "time", oneOf(INDICATORS), INDICATORS.join(" / ")) ?? startup.indicator;
    startup.speed = read(time, "speed", "time", (v): v is number => isNum(v) && [1, 2, 4, 8, 16].includes(v), "1, 2, 4, 8 atau 16") ?? startup.speed;
    appConfig.realtimeRefreshMinutes = read(time, "realtimeRefreshMinutes", "time", isNum, "angka (menit)") ?? appConfig.realtimeRefreshMinutes;
    appConfig.maxHistoricalDays = read(time, "maxHistoricalDays", "time", isNum, "angka (hari)") ?? appConfig.maxHistoricalDays;
  }

  // Checked per entry, so one wrong value does not discard the other layers.
  const layers = read(raw, "layers", "config", isObj, "objek { id layer: true/false }");
  if (layers) {
    for (const [id, value] of Object.entries(layers)) {
      if (isBool(value)) startup.layers[id] = value;
      else problems.push(`layers.${id}: harus true/false`);
    }
  }

  const w = section(raw, "widgets");
  if (w) {
    startup.widgets = read(w, "enabled", "widgets", (v): v is string[] => Array.isArray(v) && v.every(isStr), "daftar id widget") ?? startup.widgets;
    startup.openWidget = read(w, "open", "widgets", isStr, 'id widget atau ""') ?? startup.openWidget;
    startup.timelineDock = read(w, "timelineDock", "widgets", isBool, "true/false") ?? startup.timelineDock;
  }

  const b = section(raw, "basemaps");
  if (b) {
    appConfig.basemaps.dark = read(b, "dark", "basemaps", isStr, "id basemap") ?? appConfig.basemaps.dark;
    appConfig.basemaps.light = read(b, "light", "basemaps", isStr, "id basemap") ?? appConfig.basemaps.light;
    appConfig.fallbackBasemaps.dark = read(b, "fallbackDark", "basemaps", isStr, "id basemap") ?? appConfig.fallbackBasemaps.dark;
    appConfig.fallbackBasemaps.light = read(b, "fallbackLight", "basemaps", isStr, "id basemap") ?? appConfig.fallbackBasemaps.light;
    const options = read(b, "options", "basemaps", arrayOf((v): v is { id: string; label: string } => isObj(v) && isStr(v.id) && isStr(v.label)), "daftar { id, label }");
    if (options) appConfig.basemapOptions = options;
  }

  const buildings = read(raw, "buildings", "config", isBuildingSource, "sumber bangunan (lihat schema)");
  if (buildings) appConfig.buildings = buildings;
  const fallback = read(raw, "buildingsFallback", "config", isBuildingSource, "sumber bangunan (lihat schema)");
  if (fallback && fallback.type !== "basemap") appConfig.buildingsFallback = fallback;

  const stations = read(raw, "stations", "config", arrayOf(isStation), "daftar stasiun { id, name, shortName, kind, latitude, longitude }");
  if (stations) appConfig.stations = stations;
  const weather = read(raw, "weatherLocations", "config", arrayOf(isWeatherLocation), "daftar titik cuaca { id, name, latitude, longitude, adm4 }");
  if (weather) appConfig.weatherLocations = weather;

  const data = section(raw, "data");
  if (data) {
    // VITE_USE_MOCK_DATA=true in .env still forces synthetic data.
    appConfig.useMockData = appConfig.useMockData || (read(data, "useMockData", "data", isBool, "true/false") ?? false);
    appConfig.bmkgBaseUrl = read(data, "bmkgBaseUrl", "data", isStr, "URL") || appConfig.bmkgBaseUrl;
  }

  const a = section(raw, "assistant");
  if (a) {
    const as = kawasan.assistant;
    as.heading = read(a, "heading", "assistant", isStr, "teks") ?? as.heading;
    as.description = read(a, "description", "assistant", isStr, "teks") ?? as.description;
    as.entryMessage = read(a, "entryMessage", "assistant", isStr, "teks") ?? as.entryMessage;
    as.suggestedPrompts = read(a, "suggestedPrompts", "assistant", (v): v is string[] => Array.isArray(v) && v.every(isStr), "daftar teks") ?? as.suggestedPrompts;
  }
}

/**
 * Fetches and applies public/config.json. Never throws: returns a message describing problems
 * (missing file, invalid JSON, invalid values) or null when everything was applied.
 */
export async function loadRuntimeConfig(): Promise<string | null> {
  problems.length = 0;
  let raw: unknown;
  try {
    const res = await fetch(CONFIG_URL, { cache: "no-cache" });
    if (res.status === 404) return null; // no file: defaults
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.json();
  } catch (err) {
    const msg = `config.json tidak dapat dibaca (${err instanceof Error ? err.message : String(err)}); memakai pengaturan bawaan.`;
    console.warn(msg);
    return msg;
  }
  if (!isObj(raw)) return "config.json harus berupa objek JSON; memakai pengaturan bawaan.";
  apply(raw);
  if (!problems.length) return null;
  console.warn("config.json: nilai tidak valid diabaikan:\n" + problems.join("\n"));
  return `config.json: ${problems.length} nilai tidak valid diabaikan (lihat console): ${problems.slice(0, 3).join("; ")}${problems.length > 3 ? "; …" : ""}`;
}
