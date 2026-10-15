import type { MonitoringStation, WeatherLocation } from "../core/types";

/**
 * Building source. Swap this to change the 3D city model without touching code:
 *  - "basemap": use the buildings of the active ArcGIS 3D basemap (e.g. dark-gray-3d);
 *    `fallback` is added when a 2D basemap is active or the 3D basemap fails to load
 *  - "portal-item": any ArcGIS Online / Enterprise item. Layer items (scene/feature service) are
 *    added as the building layer; Web Scene / Web Map items are used as the basemap instead
 *  - "scene-service": a SceneServer URL (e.g. a Jakarta Satu 3D service)
 *  - "geojson": footprints with a height attribute (e.g. an Overture Maps extract), extruded client-side
 */
export type BuildingSource =
  | { type: "basemap"; fallback?: Exclude<BuildingSource, { type: "basemap" }> }
  | { type: "portal-item"; id: string; portalUrl?: string }
  | { type: "scene-service"; url: string }
  | { type: "geojson"; url: string; heightField: string; defaultHeight?: number };

export interface AppConfig {
  title: string;
  subtitle: string;
  camera: { longitude: number; latitude: number; z: number; heading: number; tilt: number };
  /** Area covered by the interpolated pollution surface: [xmin, ymin, xmax, ymax] in WGS84. */
  extent: [number, number, number, number];
  /** Grid cell size (degrees) of the pollution surface. Smaller = smoother but heavier. */
  gridCellSize: number;
  /** GeoJSON polygon used to clip the pollution surface to DKI Jakarta. */
  boundaryUrl: string;
  /** Activity data + emission factors for the carbon emission module. */
  emissionInventoryUrl: string;
  /** Folder of the scheduled air-quality archive (see scripts/collect-archive.mjs). */
  archiveUrl: string;
  /** Tree species table for the planting simulation. */
  treeSpeciesUrl: string;
  /** Default basemap per theme (ArcGIS 3D basemaps include 3D buildings, labels and trees). */
  basemaps: { dark: string; light: string };
  /** Used when the 3D basemap cannot be loaded (e.g. no access); paired with buildings.fallback. */
  fallbackBasemaps: { dark: string; light: string };
  /** Choices offered in the Layers widget. */
  basemapOptions: { id: string; label: string }[];
  buildings: BuildingSource;
  buildingsFallback?: Exclude<BuildingSource, { type: "basemap" }>;
  stations: MonitoringStation[];
  weatherLocations: WeatherLocation[];
  realtimeRefreshMinutes: number;
  /** Maximum length of a historical query, in days. */
  maxHistoricalDays: number;
  bmkgBaseUrl: string;
  useMockData: boolean;
}

const env = import.meta.env;

export const appConfig: AppConfig = {
  title: "Peta Kawasan SCBD & PIK",
  subtitle: "Digital twin kawasan & kualitas udara Jakarta",
  // Start view: SCBD (same camera as the SCBD bookmark, see src/config.ts).
  camera: { longitude: 106.8115, latitude: -6.234, z: 650, heading: 0, tilt: 62 },
  extent: [106.68, -6.375, 106.98, -6.085],
  gridCellSize: 0.012,
  boundaryUrl: "./data/dki-boundary.geojson",
  emissionInventoryUrl: "./data/emission-inventory.json",
  archiveUrl: "./data/archive",
  treeSpeciesUrl: "./data/tree-species.json",
  basemaps: { dark: "dark-gray-3d", light: "gray-3d" },
  fallbackBasemaps: { dark: "dark-gray-vector", light: "gray-vector" },
  basemapOptions: [
    { id: "dark-gray-3d", label: "Dark Gray 3D" },
    { id: "gray-3d", label: "Light Gray 3D" },
    { id: "navigation-dark-3d", label: "Navigasi gelap 3D" },
    { id: "navigation-3d", label: "Navigasi 3D" },
    { id: "streets-3d", label: "Streets 3D" },
    { id: "topo-3d", label: "Topografi 3D" },
    { id: "osm-3d", label: "OpenStreetMap 3D" },
    { id: "satellite", label: "Citra satelit (2D + bangunan OSM)" },
    { id: "dark-gray-vector", label: "Dark Gray 2D (+ bangunan OSM)" },
  ],
  // Primary 3D source: ArcGIS item c444b24b184c4523a5dc96248bfea4e1 (type detected at runtime).
  buildings: { type: "portal-item", id: "c444b24b184c4523a5dc96248bfea4e1" },
  // Used when the primary source cannot be loaded.
  buildingsFallback: { type: "portal-item", id: "ca0470dbbddb4db28bad74ed39949e25" }, // Esri OSM 3D Buildings

  // Monitoring points. Coordinates of the SPKU and US Embassy monitors are
  // approximate; "model" points only sample the model grid to fill gaps.
  stations: [
    { id: "dki1", shortName: "DKI1", name: "DKI1 Bundaran HI", kind: "spku", district: "Jakarta Pusat", latitude: -6.1949, longitude: 106.823 },
    { id: "dki2", shortName: "DKI2", name: "DKI2 Kelapa Gading", kind: "spku", district: "Jakarta Utara", latitude: -6.1536, longitude: 106.9106 },
    { id: "dki3", shortName: "DKI3", name: "DKI3 Jagakarsa", kind: "spku", district: "Jakarta Selatan", latitude: -6.3574, longitude: 106.803 },
    { id: "dki4", shortName: "DKI4", name: "DKI4 Lubang Buaya", kind: "spku", district: "Jakarta Timur", latitude: -6.2887, longitude: 106.9093 },
    { id: "dki5", shortName: "DKI5", name: "DKI5 Kebon Jeruk", kind: "spku", district: "Jakarta Barat", latitude: -6.2074, longitude: 106.753 },
    { id: "usemb-c", shortName: "USE-C", name: "US Embassy Jakarta Central", kind: "embassy", district: "Jakarta Pusat", latitude: -6.1822, longitude: 106.8342 },
    { id: "usemb-s", shortName: "USE-S", name: "US Embassy Jakarta South", kind: "embassy", district: "Jakarta Selatan", latitude: -6.2361, longitude: 106.7934 },
    { id: "m-priok", shortName: "Priok", name: "Tanjung Priok", kind: "model", district: "Jakarta Utara", latitude: -6.11, longitude: 106.88 },
    { id: "m-cengkareng", shortName: "Cengkareng", name: "Cengkareng", kind: "model", district: "Jakarta Barat", latitude: -6.15, longitude: 106.735 },
    { id: "m-cakung", shortName: "Cakung", name: "Cakung", kind: "model", district: "Jakarta Timur", latitude: -6.185, longitude: 106.945 },
    { id: "m-pasarminggu", shortName: "Ps. Minggu", name: "Pasar Minggu", kind: "model", district: "Jakarta Selatan", latitude: -6.285, longitude: 106.845 },
  ],

  // One representative kelurahan per kota administrasi for BMKG's
  // `prakiraan-cuaca?adm4=` endpoint (Kepmendagri codes; verify against
  // BMKG's region list if a request fails). Coordinates are kept fixed so
  // every weather provider samples the same points.
  weatherLocations: [
    { id: "jakpus", name: "Jakarta Pusat", adm4: "31.71.01.1001", latitude: -6.1767, longitude: 106.8262 },
    { id: "jakut", name: "Jakarta Utara", adm4: "31.72.01.1001", latitude: -6.1258, longitude: 106.7942 },
    { id: "jakbar", name: "Jakarta Barat", adm4: "31.73.01.1001", latitude: -6.1435, longitude: 106.73 },
    { id: "jaksel", name: "Jakarta Selatan", adm4: "31.74.01.1001", latitude: -6.2363, longitude: 106.8463 },
    { id: "jaktim", name: "Jakarta Timur", adm4: "31.75.01.1001", latitude: -6.2087, longitude: 106.8693 },
  ],

  realtimeRefreshMinutes: 15,
  maxHistoricalDays: 31,
  bmkgBaseUrl: env.VITE_BMKG_BASE_URL || (env.DEV ? "/proxy/bmkg" : "https://api.bmkg.go.id"),
  useMockData: env.VITE_USE_MOCK_DATA === "true",
};
