import Graphic from "@arcgis/core/Graphic";
import Mesh from "@arcgis/core/geometry/Mesh";
import Multipoint from "@arcgis/core/geometry/Multipoint";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
import MeshComponent from "@arcgis/core/geometry/support/MeshComponent";
import * as projectOperator from "@arcgis/core/geometry/operators/projectOperator";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import { ShapeUtils, Vector2 } from "three";
import type { Obstacle } from "../core/obstacleSources";

/**
 * CityJSON (OGC community standard, JSON encoding of CityGML; e.g. 3D BAG,
 * 3DCityDB exports) → one georeferenced Mesh in a GraphicsLayer. Runs in the
 * browser: vertices are decoded with the file's transform, projected from the
 * file's EPSG code to Web Mercator and every surface is triangulated. Faces
 * are coloured by semantic surface (roof / wall / ground) or by object type.
 */

type Ring = number[];
interface CityGeometry {
  type: string;
  lod?: string | number;
  boundaries: unknown;
  semantics?: { surfaces: { type: string }[]; values: unknown };
}
interface CityJSONDoc {
  type: "CityJSON";
  version?: string;
  transform?: { scale: [number, number, number]; translate: [number, number, number] };
  metadata?: { referenceSystem?: string; title?: string };
  CityObjects: Record<string, { type: string; geometry?: CityGeometry[] }>;
  vertices: [number, number, number][];
}

/** Material classes; the colour of each is set below. */
const CLASSES = ["roof", "wall", "ground", "terrain", "vegetation", "water", "transport", "other"] as const;
type Klass = (typeof CLASSES)[number];
const COLORS: Record<Klass, [number, number, number]> = {
  roof: [214, 104, 83],
  wall: [226, 222, 214],
  ground: [120, 120, 120],
  terrain: [168, 160, 130],
  vegetation: [96, 160, 90],
  water: [80, 140, 210],
  transport: [110, 110, 120],
  other: [190, 190, 200],
};

function classOf(objectType: string, surfaceType?: string): Klass {
  if (surfaceType) {
    if (/Roof/i.test(surfaceType)) return "roof";
    if (/Wall|Closure|Door|Window/i.test(surfaceType)) return "wall";
    if (/Ground|Floor/i.test(surfaceType)) return "ground";
  }
  if (/Building|Bridge|Tunnel|Construction/i.test(objectType)) return "wall";
  if (/TINRelief|LandUse/i.test(objectType)) return "terrain";
  if (/Vegetation|PlantCover/i.test(objectType)) return "vegetation";
  if (/Water/i.test(objectType)) return "water";
  if (/Road|Railway|Transport|Square/i.test(objectType)) return "transport";
  return "other";
}

/** Compound CRSs (horizontal + vertical) that the projection engine handles via their horizontal part. */
const COMPOUND_TO_HORIZONTAL: Record<number, number> = { 7415: 28992, 5555: 25832, 5556: 25833, 7405: 27700, 6697: 6668 };

export function epsgFromReferenceSystem(ref?: string): number | null {
  const m = ref?.match(/EPSG(?:\/\d+\/|::?)(\d+)/i) ?? ref?.match(/(\d{4,6})\s*$/);
  return m ? Number(m[1]) : null;
}

/** Surfaces of a geometry with their semantic type, regardless of its nesting depth. */
function* surfaces(geom: CityGeometry): Generator<{ rings: Ring[]; semantic?: string }> {
  const sem = geom.semantics;
  const semType = (v: unknown) => (typeof v === "number" ? sem?.surfaces[v]?.type : undefined);
  const b = geom.boundaries as unknown[];
  const v = sem?.values as unknown[] | undefined;
  switch (geom.type) {
    case "MultiSurface":
    case "CompositeSurface":
      for (let i = 0; i < b.length; i++) yield { rings: b[i] as Ring[], semantic: semType(v?.[i]) };
      break;
    case "Solid":
      for (let s = 0; s < b.length; s++) {
        const shell = b[s] as Ring[][];
        for (let i = 0; i < shell.length; i++) yield { rings: shell[i], semantic: semType((v?.[s] as unknown[] | undefined)?.[i]) };
      }
      break;
    case "MultiSolid":
    case "CompositeSolid":
      for (let k = 0; k < b.length; k++) {
        const solid = b[k] as Ring[][][];
        for (let s = 0; s < solid.length; s++) {
          for (let i = 0; i < solid[s].length; i++) {
            yield { rings: solid[s][i], semantic: semType(((v?.[k] as unknown[] | undefined)?.[s] as unknown[] | undefined)?.[i]) };
          }
        }
      }
      break;
  }
}

/** Triangulate a planar 3D polygon (outer ring + holes); returns vertex indices. */
function triangulate(rings: Ring[], pos: Float64Array): number[] {
  const outer = rings[0];
  if (!outer || outer.length < 3) return [];
  if (outer.length === 3 && rings.length === 1) return outer.slice();
  // Newell normal → drop the dominant axis to get a 2D polygon.
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i] * 3, b = outer[(i + 1) % outer.length] * 3;
    nx += (pos[a + 1] - pos[b + 1]) * (pos[a + 2] + pos[b + 2]);
    ny += (pos[a + 2] - pos[b + 2]) * (pos[a] + pos[b]);
    nz += (pos[a] - pos[b]) * (pos[a + 1] + pos[b + 1]);
  }
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  const [u, w] = az >= ax && az >= ay ? [0, 1] : ay >= ax ? [0, 2] : [1, 2];
  const to2d = (ring: Ring) => ring.map((i) => new Vector2(pos[i * 3 + u], pos[i * 3 + w]));
  const flat = rings.flat();
  const tris = ShapeUtils.triangulateShape(to2d(outer), rings.slice(1).map(to2d));
  return tris.flat().map((k) => flat[k]);
}

export interface CityJSONResult {
  layer: GraphicsLayer;
  objects: number;
  triangles: number;
  epsg: number | null;
  /** Bounding box + height per building-like object (Web Mercator). */
  obstacles: Obstacle[];
}

/**
 * Build a layer from a CityJSON document. `epsgOverride` replaces the file's
 * reference system; without any, coordinates are treated as local metres and
 * placed at `fallbackCenter` (Web Mercator x/y).
 */
export async function cityJsonToLayer(doc: CityJSONDoc, epsgOverride: number | null, fallbackCenter: [number, number]): Promise<CityJSONResult> {
  if (doc?.type !== "CityJSON" || !Array.isArray(doc.vertices)) throw new Error("Bukan berkas CityJSON.");
  const n = doc.vertices.length;
  const [sx, sy, sz] = doc.transform?.scale ?? [1, 1, 1];
  const [tx, ty, tz] = doc.transform?.translate ?? [0, 0, 0];
  const pos = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = doc.vertices[i];
    pos[i * 3] = v[0] * sx + tx;
    pos[i * 3 + 1] = v[1] * sy + ty;
    pos[i * 3 + 2] = v[2] * sz + tz;
  }

  // Triangulate in the source CRS (metric, planar), then project the vertices.
  const faces: Record<Klass, number[]> = Object.fromEntries(CLASSES.map((c) => [c, []])) as never;
  let objects = 0;
  // Vertices of each building-like object, for its wind obstacle box.
  const solids: number[][] = [];
  for (const obj of Object.values(doc.CityObjects ?? {})) {
    if (!obj.geometry?.length) continue;
    // Highest LoD only, so LoD1 blocks don't overlap LoD2 roofs.
    const best = obj.geometry.reduce((a, g) => (Number(g.lod ?? 0) > Number(a.lod ?? 0) ? g : a));
    objects++;
    const used: number[] = [];
    for (const s of surfaces(best)) {
      const tris = triangulate(s.rings, pos);
      faces[classOf(obj.type, s.semantic)].push(...tris);
      used.push(...tris);
    }
    if (/Building|Bridge|Tunnel|Construction|Tree|Vegetation/i.test(obj.type) && used.length) solids.push(used);
  }

  const fileEpsg = epsgFromReferenceSystem(doc.metadata?.referenceSystem);
  let epsg = epsgOverride ?? fileEpsg;
  if (epsg && COMPOUND_TO_HORIZONTAL[epsg]) epsg = COMPOUND_TO_HORIZONTAL[epsg];

  const out = new Float64Array(n * 3);
  if (epsg && epsg !== 3857 && epsg !== 102100) {
    await projectOperator.load();
    const points: number[][] = [];
    for (let i = 0; i < n; i++) points.push([pos[i * 3], pos[i * 3 + 1]]);
    const projected = projectOperator.execute(new Multipoint({ points, spatialReference: new SpatialReference({ wkid: epsg }) }), SpatialReference.WebMercator) as Multipoint | null;
    if (!projected || projected.points.length !== n) throw new Error(`Tidak dapat memproyeksikan dari EPSG:${epsg}. Isi kode EPSG horizontal secara manual.`);
    for (let i = 0; i < n; i++) {
      out[i * 3] = projected.points[i][0];
      out[i * 3 + 1] = projected.points[i][1];
      out[i * 3 + 2] = pos[i * 3 + 2];
    }
  } else if (epsg) {
    out.set(pos);
  } else {
    // Local coordinates: centre the model on the view.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, minZ = Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, pos[i * 3]); maxX = Math.max(maxX, pos[i * 3]);
      minY = Math.min(minY, pos[i * 3 + 1]); maxY = Math.max(maxY, pos[i * 3 + 1]);
      minZ = Math.min(minZ, pos[i * 3 + 2]);
    }
    for (let i = 0; i < n; i++) {
      out[i * 3] = pos[i * 3] - (minX + maxX) / 2 + fallbackCenter[0];
      out[i * 3 + 1] = pos[i * 3 + 1] - (minY + maxY) / 2 + fallbackCenter[1];
      out[i * 3 + 2] = pos[i * 3 + 2] - minZ;
    }
  }

  // One axis-aligned box per object, used to block the wind simulation.
  const obstacles: Obstacle[] = [];
  for (const used of solids) {
    let xmin = Infinity, ymin = Infinity, zmin = Infinity, xmax = -Infinity, ymax = -Infinity, zmax = -Infinity;
    for (const i of used) {
      xmin = Math.min(xmin, out[i * 3]); xmax = Math.max(xmax, out[i * 3]);
      ymin = Math.min(ymin, out[i * 3 + 1]); ymax = Math.max(ymax, out[i * 3 + 1]);
      zmin = Math.min(zmin, out[i * 3 + 2]); zmax = Math.max(zmax, out[i * 3 + 2]);
    }
    if (zmax - zmin > 1) obstacles.push({ xmin, ymin, xmax, ymax, height: zmax - zmin, porosity: 1 });
  }

  const components = CLASSES.filter((c) => faces[c].length).map(
    (c) => new MeshComponent({ faces: new Uint32Array(faces[c]), material: { color: COLORS[c] }, shading: "flat" }),
  );
  if (!components.length) throw new Error("CityJSON tidak berisi geometri yang dapat ditampilkan.");
  const mesh = new Mesh({ vertexAttributes: { position: out }, components, spatialReference: SpatialReference.WebMercator });
  const layer = new GraphicsLayer({ title: doc.metadata?.title || "CityJSON", elevationInfo: { mode: "absolute-height" } });
  layer.add(new Graphic({ geometry: mesh, symbol: { type: "mesh-3d", symbolLayers: [{ type: "fill" }] } as never }));
  layer.fullExtent = mesh.extent;
  const triangles = components.reduce((sum, c) => sum + (c.faces?.length ?? 0) / 3, 0);
  return { layer, objects, triangles, epsg, obstacles };
}
