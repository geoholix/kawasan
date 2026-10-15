import type Layer from "@arcgis/core/layers/Layer";
import { Store } from "../core/store";

export type SourceKind =
  | "arcgis-url"
  | "portal-item"
  | "wms"
  | "wmts"
  | "wfs"
  | "ogc-features"
  | "geojson"
  | "csv"
  | "3dtiles"
  | "i3s"
  | "cityjson"
  | "model-url"
  | "file-csv"
  | "file-geojson"
  | "file-cityjson";

export interface SourceSpec {
  kind: SourceKind;
  /** URL, portal item id, or a blob: URL for local files. */
  url: string;
  /** Optional extra parameter: WFS feature type name, OGC collection id, portal URL, query string, EPSG code, location. */
  param?: string;
  title?: string;
  /** Extrude polygons as 3D buildings using a detected height / floors field. */
  extrude?: boolean;
}

export interface AddedLayer {
  id: string;
  spec: SourceSpec;
  title: string;
  typeLabel: string;
  layer: Layer;
  /** Local files cannot be restored after a reload. */
  persistent: boolean;
}

export interface PlacedModel {
  id: string;
  fileName: string;
  /** e.g. "glTF/GLB" or "IFC → GLB". */
  format: string;
}

export interface AddDataState {
  entries: AddedLayer[];
  busy: boolean;
  message: { kind: "success" | "danger" | "info"; text: string } | null;
  /** 3D models placed in the scene (session only). */
  models: PlacedModel[];
}

export const addDataStore = new Store<AddDataState>({
  entries: [],
  busy: false,
  message: null,
  models: [],
});

const STORAGE_KEY = "dt-airpolution:added-layers";

export function savedSpecs(): SourceSpec[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

addDataStore.on(["entries"], (s) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s.entries.filter((e) => e.persistent).map((e) => e.spec)));
  } catch {
    /* storage unavailable */
  }
});
