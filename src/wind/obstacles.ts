import type Extent from "@arcgis/core/geometry/Extent";
import type SceneLayer from "@arcgis/core/layers/SceneLayer";
import type SceneView from "@arcgis/core/views/SceneView";
import type SceneLayerView from "@arcgis/core/views/layers/SceneLayerView";
import { toMercator } from "../core/geo";
import { obstacleFromExtent, type Obstacle } from "../core/obstacleSources";
import type { TreeSpecies, TreePlanting } from "../greening/state";
import type { WhatIfBuilding } from "./state";

export type { Obstacle } from "../core/obstacleSources";

const MAX_FEATURES = 25_000;

/**
 * Read building footprints + heights from every visible 3D-object scene layer
 * (3D basemap buildings, the configured building item, OSM buildings). Only
 * features already loaded by the view are available, so this works best when
 * zoomed in. Footprints are approximated by each mesh's bounding box.
 */
export async function sceneBuildingObstacles(view: SceneView, extent: Extent, signal?: AbortSignal): Promise<Obstacle[]> {
  const out: Obstacle[] = [];
  const layerViews = view.allLayerViews
    .toArray()
    .filter((lv) => lv.layer.type === "scene" && (lv.layer as SceneLayer).geometryType === "mesh" && lv.visible && !lv.suspended) as SceneLayerView[];

  for (const lv of layerViews) {
    try {
      const query = lv.createQuery();
      query.geometry = extent;
      query.returnGeometry = true;
      query.outFields = [];
      const result = await lv.queryFeatures(query, { signal });
      for (const f of result.features) {
        const e = f.geometry?.extent;
        if (!e) continue;
        const o = obstacleFromExtent(e);
        if (!o || o.height < 3) continue;
        out.push(o);
        if (out.length >= MAX_FEATURES) return out;
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err;
      console.warn("Building query failed for", lv.layer.title, err);
    }
  }
  return out;
}

export function whatIfObstacles(buildings: WhatIfBuilding[]): Obstacle[] {
  return buildings.map((b) => {
    const [x, y] = toMercator(b.longitude, b.latitude);
    // Mercator scale factor at this latitude keeps the footprint in true metres.
    const half = b.sizeM / 2 / Math.cos((b.latitude * Math.PI) / 180);
    return { xmin: x - half, ymin: y - half, xmax: x + half, ymax: y + half, height: b.heightM, porosity: 1 };
  });
}

/** Trees as porous obstacles (crown footprint, ~45% of a solid wall's blocking). */
export function treeObstacles(plantings: TreePlanting[], species: TreeSpecies[]): Obstacle[] {
  const out: Obstacle[] = [];
  for (const p of plantings) {
    const sp = species.find((s) => s.id === p.speciesId);
    if (!sp) continue;
    for (const [lon, lat] of p.positions) {
      const [x, y] = toMercator(lon, lat);
      const half = sp.crownM / 2 / Math.cos((lat * Math.PI) / 180);
      out.push({ xmin: x - half, ymin: y - half, xmax: x + half, ymax: y + half, height: sp.heightM, porosity: 0.45 });
    }
  }
  return out;
}
