import CSVLayer from "@arcgis/core/layers/CSVLayer";
import GeoJSONLayer from "@arcgis/core/layers/GeoJSONLayer";
import IntegratedMesh3DTilesLayer from "@arcgis/core/layers/IntegratedMesh3DTilesLayer";
import Layer from "@arcgis/core/layers/Layer";
import PortalItem from "@arcgis/core/portal/PortalItem";
import SceneLayer from "@arcgis/core/layers/SceneLayer";
import type FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import OGCFeatureLayer from "@arcgis/core/layers/OGCFeatureLayer";
import WFSLayer from "@arcgis/core/layers/WFSLayer";
import WMSLayer from "@arcgis/core/layers/WMSLayer";
import WMTSLayer from "@arcgis/core/layers/WMTSLayer";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import type Extent from "@arcgis/core/geometry/Extent";
import type SceneView from "@arcgis/core/views/SceneView";
import type FeatureLayerView from "@arcgis/core/views/layers/FeatureLayerView";
import { intersects, notifyObstaclesChanged, obstacleFromExtent, registerObstacleSource, type Obstacle, type ObstacleSource } from "../core/obstacleSources";
import type { SourceKind, SourceSpec } from "./state";

export interface SourceOption {
  kind: SourceKind;
  label: string;
  group: "ArcGIS" | "OGC" | "Berkas / format terbuka" | "3D terbuka";
  urlLabel: string;
  placeholder: string;
  paramLabel?: string;
  hint: string;
  /** Polygon results can be extruded as 3D buildings. */
  extrudable?: boolean;
}

/** Every source the Add data menu offers. Add an entry + a case in createLayer() to support a new type. */
export const SOURCE_OPTIONS: SourceOption[] = [
  {
    kind: "arcgis-url",
    label: "Layanan ArcGIS (URL)",
    group: "ArcGIS",
    urlLabel: "URL layanan",
    placeholder: "https://…/arcgis/rest/services/…/FeatureServer/0",
    hint: "Jenis dideteksi otomatis: FeatureServer, MapServer, ImageServer, SceneServer (I3S), VectorTileServer, ElevationServer.",
    extrudable: true,
  },
  {
    kind: "portal-item",
    label: "Item ArcGIS Online / Portal (ID)",
    group: "ArcGIS",
    urlLabel: "Item ID",
    placeholder: "c444b24b184c4523a5dc96248bfea4e1",
    paramLabel: "URL portal (opsional)",
    hint: "Layer item apa pun dari ArcGIS Online atau ArcGIS Enterprise.",
  },
  { kind: "wms", label: "OGC WMS", group: "OGC", urlLabel: "URL WMS", placeholder: "https://…/wms", hint: "Web Map Service (gambar peta), mis. dari geoserver Jakarta Satu." },
  { kind: "wmts", label: "OGC WMTS", group: "OGC", urlLabel: "URL WMTS", placeholder: "https://…/wmts", hint: "Web Map Tile Service (tile peta)." },
  {
    kind: "wfs",
    label: "OGC WFS",
    group: "OGC",
    urlLabel: "URL WFS",
    placeholder: "https://…/wfs",
    paramLabel: "Nama feature type (opsional)",
    hint: "Web Feature Service 2.0 (GeoJSON). Kosongkan nama untuk memakai feature type pertama.",
    extrudable: true,
  },
  {
    kind: "ogc-features",
    label: "OGC API – Features",
    group: "OGC",
    urlLabel: "URL landing page",
    placeholder: "https://…/ogcapi",
    paramLabel: "Collection ID (opsional)",
    hint: "Kosongkan collection untuk memakai koleksi pertama.",
    extrudable: true,
  },
  { kind: "geojson", label: "GeoJSON (URL)", group: "Berkas / format terbuka", urlLabel: "URL GeoJSON", placeholder: "https://…/data.geojson", hint: "FeatureCollection dalam WGS84.", extrudable: true },
  { kind: "csv", label: "CSV (URL)", group: "Berkas / format terbuka", urlLabel: "URL CSV", placeholder: "https://…/data.csv", hint: "Kolom koordinat (lat/lon, latitude/longitude, y/x) dideteksi otomatis." },
  {
    kind: "i3s",
    label: "OGC I3S (Scene Layer)",
    group: "3D terbuka",
    urlLabel: "URL SceneServer / layer I3S",
    placeholder: "https://…/SceneServer/layers/0",
    hint: "Standar OGC I3S: bangunan 3D dengan atribut, mesh, point cloud. Dari ArcGIS Enterprise (mis. Jakarta Satu), atau I3S hasil loaders.gl tile-converter yang di-hosting statis.",
  },
  {
    kind: "3dtiles",
    label: "OGC 3D Tiles",
    group: "3D terbuka",
    urlLabel: "URL tileset.json",
    placeholder: "https://…/tileset.json",
    paramLabel: "Parameter kueri (opsional)",
    hint: "OGC 3D Tiles 1.0/1.1 (mis. hasil pg2b3dm/py3dtiles, PLATEAU, 3D BAG). Parameter kueri untuk layanan berkunci, mis. key=API_KEY (Google Photorealistic 3D Tiles: https://tile.googleapis.com/v1/3dtiles/root.json).",
  },
  {
    kind: "cityjson",
    label: "CityJSON (URL)",
    group: "3D terbuka",
    urlLabel: "URL CityJSON",
    placeholder: "https://…/kota.city.json",
    paramLabel: "Kode EPSG (opsional)",
    hint: "Encoding JSON dari CityGML (mis. 3D BAG, ekspor 3DCityDB). Dikonversi ke mesh di browser; atap/dinding diwarnai dari semantik. EPSG dibaca dari berkas, isi manual bila kosong.",
  },
  {
    kind: "model-url",
    label: "Model 3D (URL: glTF/GLB, IFC, OBJ …)",
    group: "3D terbuka",
    urlLabel: "URL model",
    placeholder: "https://…/gedung.glb",
    paramLabel: "Lokasi bujur, lintang (opsional)",
    hint: "Satu berkas model dari repositori terbuka (GitHub, Zenodo, dsb.). Isi lokasi (mis. 106.8227, -6.1945) untuk langsung ditempatkan, atau kosongkan lalu klik di peta.",
  },
];

export const TYPE_LABELS: Record<SourceKind, string> = {
  "arcgis-url": "ArcGIS",
  "portal-item": "Item ArcGIS",
  wms: "WMS",
  wmts: "WMTS",
  wfs: "WFS",
  "ogc-features": "OGC API Features",
  geojson: "GeoJSON",
  csv: "CSV",
  "3dtiles": "3D Tiles",
  i3s: "I3S",
  cityjson: "CityJSON",
  "model-url": "Model 3D",
  "file-csv": "CSV (berkas)",
  "file-geojson": "GeoJSON (berkas)",
  "file-cityjson": "CityJSON (berkas)",
};

async function firstOgcCollection(url: string): Promise<string> {
  const res = await fetch(`${url.replace(/\/$/, "")}/collections?f=json`);
  if (!res.ok) throw new Error(`Tidak dapat membaca daftar koleksi (${res.status})`);
  const json = await res.json();
  const id = json.collections?.[0]?.id;
  if (!id) throw new Error("Layanan tidak memiliki koleksi");
  return id;
}

/** "a=1&b=2" → { a: "1", b: "2" } */
function parseQuery(q?: string): Record<string, string> | undefined {
  if (!q) return undefined;
  return Object.fromEntries(new URLSearchParams(q.replace(/^\?/, "")));
}

/** Fields that hold a height in metres or a number of floors, in order of preference. */
const HEIGHT_FIELDS = ["height", "render_height", "building:height", "bldg_height", "measuredheight", "tinggi", "hgt", "b3_h_dak_50p", "h_dak"];
const FLOOR_FIELDS = ["num_floors", "building:levels", "levels", "storeys", "jumlah_lantai", "lantai", "floors", "bldg_levels"];
export const FLOOR_HEIGHT = 3.2;
export const DEFAULT_BUILDING_HEIGHT = 9;

/**
 * Register `source` as wind obstacles while `layer` is in the map and visible;
 * unregister once the layer is removed.
 */
function obstaclesWhileInMap(layer: Layer, source: ObstacleSource): void {
  const unregister = registerObstacleSource(`layer:${layer.uid}`, (extent, signal) => (layer.visible && layer.parent ? source(extent, signal) : []));
  reactiveUtils.watch(() => layer.visible, notifyObstaclesChanged);
  reactiveUtils.watch(
    () => layer.parent,
    (parent, oldParent) => (!parent && oldParent ? unregister() : notifyObstaclesChanged()),
  );
}

/** Extrude a polygon layer as 3D buildings from the first height / floors field it has. Returns the source of the height. */
export function applyExtrusion(layer: Layer): { label: string; heightOf: (attributes: Record<string, unknown>) => number } {
  const fl = layer as FeatureLayer;
  if (!("geometryType" in fl) || fl.geometryType !== "polygon") throw new Error("Ekstrusi hanya untuk layer poligon.");
  const names = new Map((fl.fields ?? []).map((f) => [f.name.toLowerCase(), f.name]));
  const height = HEIGHT_FIELDS.map((f) => names.get(f)).find(Boolean);
  const floors = FLOOR_FIELDS.map((f) => names.get(f)).find(Boolean);
  const read = (name: string) => `Number(DefaultValue($feature[${JSON.stringify(name)}], 0))`;
  const expression = [
    height ? `var h = ${read(height)}; if (h > 0) return h;` : "",
    floors ? `var l = ${read(floors)}; if (l > 0) return l * ${FLOOR_HEIGHT};` : "",
    `return ${DEFAULT_BUILDING_HEIGHT};`,
  ].join(" ");
  fl.elevationInfo = { mode: "on-the-ground" } as never;
  fl.renderer = {
    type: "simple",
    symbol: {
      type: "polygon-3d",
      symbolLayers: [{ type: "extrude", material: { color: [226, 222, 214, 1] }, edges: { type: "solid", color: [60, 60, 60, 0.5], size: 0.5 } }],
    },
    visualVariables: [{ type: "size", valueExpression: expression, valueUnit: "meters" }],
  } as never;
  const heightOf = (a: Record<string, unknown>) => {
    const h = height ? Number(a?.[height]) : NaN;
    if (h > 0) return h;
    const l = floors ? Number(a?.[floors]) : NaN;
    return l > 0 ? l * FLOOR_HEIGHT : DEFAULT_BUILDING_HEIGHT;
  };
  return { label: height ?? (floors ? `${floors} × ${FLOOR_HEIGHT} m` : `${DEFAULT_BUILDING_HEIGHT} m (bawaan)`), heightOf };
}

/** Extruded polygons block the wind: footprint box + extrusion height of the features loaded in the view. */
function registerExtrusionObstacles(layer: Layer, heightOf: (a: Record<string, unknown>) => number): void {
  obstaclesWhileInMap(layer, async (extent: Extent, signal) => {
    const view = viewProvider?.();
    if (!view) return [];
    const lv = (await view.whenLayerView(layer)) as FeatureLayerView;
    const query = lv.createQuery();
    query.geometry = extent;
    query.returnGeometry = true;
    query.outFields = ["*"];
    const { features } = await lv.queryFeatures(query, { signal });
    return features
      .map((f) => (f.geometry?.extent ? obstacleFromExtent(f.geometry.extent, heightOf(f.attributes ?? {})) : null))
      .filter((o): o is Obstacle => !!o);
  });
}

async function createCityJsonLayer(url: string, epsg?: string): Promise<Layer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CityJSON tidak dapat diunduh (${res.status})`);
  const doc = await res.json();
  const { cityJsonToLayer } = await import("./cityjson");
  const centre = viewCentre?.() ?? [11891000, -692000];
  const { layer, obstacles } = await cityJsonToLayer(doc, epsg ? Number(epsg.replace(/\D/g, "")) : null, centre);
  // Buildings of the city model block the simulated wind.
  obstaclesWhileInMap(layer, (extent) => obstacles.filter((o) => intersects(o, extent)));
  return layer;
}

/** Supplies the view centre (Web Mercator) for sources without coordinates. */
let viewCentre: (() => [number, number]) | null = null;
let viewProvider: (() => SceneView) | null = null;
export function setViewProvider(fn: () => SceneView): void {
  viewProvider = fn;
  viewCentre = () => [fn().center?.x ?? 11891000, fn().center?.y ?? -692000];
}

/** Create (and load) an ArcGIS layer for a source specification. */
export async function createLayer(spec: SourceSpec): Promise<Layer> {
  const url = spec.url.trim();
  const param = spec.param?.trim() || undefined;
  let layer: Layer;
  switch (spec.kind) {
    case "arcgis-url":
      layer = await Layer.fromArcGISServerUrl({ url });
      break;
    case "portal-item":
      layer = await Layer.fromPortalItem({ portalItem: new PortalItem({ id: url, ...(param ? { portal: { url: param } } : {}) }) });
      break;
    case "wms":
      layer = new WMSLayer({ url });
      break;
    case "wmts":
      layer = new WMTSLayer({ url });
      break;
    case "wfs":
      layer = new WFSLayer({ url, ...(param ? { name: param } : {}) });
      break;
    case "ogc-features":
      layer = new OGCFeatureLayer({ url, collectionId: param ?? (await firstOgcCollection(url)) });
      break;
    case "geojson":
    case "file-geojson":
      layer = new GeoJSONLayer({ url });
      break;
    case "csv":
    case "file-csv":
      layer = new CSVLayer({ url });
      break;
    case "3dtiles":
      layer = new IntegratedMesh3DTilesLayer({ url, customParameters: parseQuery(param) });
      break;
    case "i3s":
      // ArcGIS detection handles integrated mesh / point cloud / building layers; plain I3S hosts fall back to SceneLayer.
      layer = await Layer.fromArcGISServerUrl({ url }).catch(() => new SceneLayer({ url }));
      break;
    case "cityjson":
    case "file-cityjson":
      layer = await createCityJsonLayer(url, param);
      break;
    case "model-url":
      throw new Error("Model dari URL ditempatkan lewat importModelFromUrl().");
  }
  if (spec.title) layer.title = spec.title;
  await layer.load();
  if (spec.extrude) registerExtrusionObstacles(layer, applyExtrusion(layer).heightOf);
  return layer;
}
