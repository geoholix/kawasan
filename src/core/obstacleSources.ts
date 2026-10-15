import type Extent from "@arcgis/core/geometry/Extent";
import { toMercator } from "./geo";

/** Axis-aligned obstacle footprint in Web Mercator metres. porosity 1 = solid building, < 1 = vegetation. */
export interface Obstacle {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  height: number;
  porosity: number;
}

/**
 * Anything in the scene that should block the simulated wind (placed 3D
 * models, CityJSON buildings, extruded polygons, …). A source returns its
 * obstacles inside `extent` (Web Mercator); it is asked again whenever the
 * wind is recomputed. Sources call notifyObstaclesChanged() when their
 * content moves, appears or disappears.
 */
export type ObstacleSource = (extent: Extent, signal?: AbortSignal) => Obstacle[] | Promise<Obstacle[]>;

const sources = new Map<string, ObstacleSource>();
const listeners = new Set<() => void>();

export function notifyObstaclesChanged(): void {
  listeners.forEach((fn) => fn());
}

/** Register a source; returns a function that unregisters it. */
export function registerObstacleSource(id: string, source: ObstacleSource): () => void {
  sources.set(id, source);
  notifyObstaclesChanged();
  return () => {
    if (sources.delete(id)) notifyObstaclesChanged();
  };
}

export function onObstaclesChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Obstacles of every registered source inside `extent`; a failing source is skipped. */
export async function collectObstacles(extent: Extent, signal?: AbortSignal): Promise<Obstacle[]> {
  const parts = await Promise.all(
    [...sources.entries()].map(async ([id, source]) => {
      try {
        return await source(extent, signal);
      } catch (err) {
        if ((err as Error)?.name === "AbortError") throw err;
        console.warn(`Obstacle source "${id}" failed`, err);
        return [];
      }
    }),
  );
  return parts.flat();
}

/** Obstacle from a 3D extent (e.g. of a mesh); `height` defaults to zmax − zmin. */
export function obstacleFromExtent(e: Extent, height = (e.zmax ?? 0) - (e.zmin ?? 0), porosity = 1): Obstacle | null {
  if (!(height > 1)) return null;
  let [xmin, ymin, xmax, ymax] = [e.xmin, e.ymin, e.xmax, e.ymax];
  if (e.spatialReference?.isGeographic) {
    [xmin, ymin] = toMercator(e.xmin, e.ymin);
    [xmax, ymax] = toMercator(e.xmax, e.ymax);
  }
  return { xmin, ymin, xmax, ymax, height, porosity };
}

/** True when two Web Mercator boxes overlap. */
export function intersects(o: Obstacle, e: Extent): boolean {
  return o.xmax >= e.xmin && o.xmin <= e.xmax && o.ymax >= e.ymin && o.ymin <= e.ymax;
}
