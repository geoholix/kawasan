const env = import.meta.env;

/**
 * Kawasan defaults. Everything here (except the API key) can be overridden at runtime by
 * public/config.json, see src/config/runtimeConfig.ts.
 */
export interface Area {
  id: string;
  name: string;
  description: string;
  /** Center of the area (WGS84): [longitude, latitude]. */
  center: [number, number];
  /** Extent [xmin, ymin, xmax, ymax] (WGS84), used for 2D and for AI context. */
  extent: [number, number, number, number];
  /** 3D camera: distance south of the center (degrees latitude), height (m), tilt, heading. */
  camera: { offsetLat: number; z: number; tilt: number; heading: number };
}

// Approximate extents: adjust to the SCBDPIK layer if needed.
export const areas: Area[] = [
  {
    id: "scbd",
    name: "SCBD",
    description: "Sudirman Central Business District, Jakarta Selatan",
    center: [106.8115, -6.2265],
    extent: [106.8025, -6.2365, 106.8205, -6.2165],
    camera: { offsetLat: 0.0075, z: 650, tilt: 62, heading: 0 },
  },
  {
    id: "pik",
    name: "PIK",
    description: "Pantai Indah Kapuk, Jakarta Utara",
    center: [106.742, -6.109],
    extent: [106.715, -6.1255, 106.77, -6.0925],
    camera: { offsetLat: 0.014, z: 1600, tilt: 60, heading: 0 },
  },
];

export const config = {
  webmapId: env.VITE_WEBMAP_ID || "e8ff91a9c03d46bd995646e06438faaf",
  portalUrl: env.VITE_PORTAL_URL || "https://tiger.maps.arcgis.com",
  clientId: env.ARCGIS_CLIENT_ID || env.VITE_ARCGIS_CLIENT_ID || "",
  apiKey: env.VITE_ARCGIS_API_KEY || "",
  /** Basemap used if the web map cannot be loaded (private item, not signed in). */
  fallbackBasemap2d: "topo-vector",
  /** Height (m) above ground of the web map's layers in 3D (ground-draped polygons are hidden by the 3D basemap). */
  layerOffset3d: 2,
  /** Visibility of web map layers by title; layers not listed keep the web map's setting. */
  webmapLayers: {} as Record<string, boolean>,
  assistant: {
    heading: "Asisten Kawasan",
    description: "Jelajahi peta SCBD & PIK dengan bahasa alami",
    entryMessage: "Saya bisa membawa Anda ke SCBD atau PIK, zoom ke layer, dan menjawab pertanyaan tentang data kawasan.",
    suggestedPrompts: ["Pergi ke SCBD", "Pergi ke PIK", "Berapa jumlah fitur pada layer SCBDPIK?"],
  },
};
