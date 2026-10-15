import type { Obstacle } from "./obstacles";
import { computeWindField, profileFactor, rasterize, type BasePoint, type Grid } from "./windField";

/** Heights (m above ground) at which the layered 3D field is computed. */
export const LEVELS = [2, 10, 25, 50, 80, 120, 180];

export interface Field3D {
  grid: Grid;
  levels: number[];
  /** u/v per level (m/s, flow-to), row-major. */
  u: Float32Array<ArrayBuffer>[];
  v: Float32Array<ArrayBuffer>[];
  /** Free-stream (unobstructed) components per level, for disturbance. */
  fu: Float32Array<ArrayBuffer>[];
  fv: Float32Array<ArrayBuffer>[];
  /** Absolute obstacle height (m) per cell. */
  heights: Float32Array<ArrayBuffer>;
}

export interface Streamlines {
  /** x, y, z triples (Web Mercator metres, z above ground) of all chunk vertices. */
  coords: Float32Array<ArrayBuffer>;
  /** Vertex offset of each chunk in `coords` (in vertices); length = chunks + 1. */
  offsets: Uint32Array<ArrayBuffer>;
  /** Mean disturbance 0–1 of each chunk. */
  disturbance: Float32Array<ArrayBuffer>;
  /** Chunk index along its streamline (drives the pulse animation). */
  sequence: Uint16Array<ArrayBuffer>;
  /** Height level class of each chunk (index into LEVELS of its seed). */
  seedLevel: Uint8Array<ArrayBuffer>;
}

export function computeField3D(grid: Grid, base: BasePoint[], obstacles: Obstacle[], buildingEffect: boolean): Field3D {
  const n = grid.width * grid.height;
  const u: Float32Array<ArrayBuffer>[] = [];
  const v: Float32Array<ArrayBuffer>[] = [];
  const fu: Float32Array<ArrayBuffer>[] = [];
  const fv: Float32Array<ArrayBuffer>[] = [];
  const ref = computeWindField(grid, base, [], false, 10); // log-profile factor is 1 at 10 m
  for (const level of LEVELS) {
    const pf = profileFactor(level);
    const f = computeWindField(grid, base, obstacles, buildingEffect, level, ref);
    u.push(f.u);
    v.push(f.v);
    fu.push(ref.u.map((x) => x * pf));
    fv.push(ref.v.map((x) => x * pf));
  }
  const heights = buildingEffect ? rasterize(grid, obstacles, 0).H : new Float32Array(n);
  return { grid, levels: LEVELS, u, v, fu, fv, heights };
}

export interface Sample {
  u: number;
  v: number;
  fu: number;
  fv: number;
  ground: number;
}

/** Sample the layered field at (x, y, z): nearest cell, linear between levels. */
export function sampleField(f: Field3D, x: number, y: number, z: number): Sample | null {
  const { grid } = f;
  const i = Math.floor((x - grid.xmin) / grid.cellSize);
  const j = Math.floor((grid.ymax - y) / grid.cellSize);
  if (i < 0 || j < 0 || i >= grid.width || j >= grid.height) return null;
  const k = j * grid.width + i;
  const L = f.levels;
  let a = 0;
  while (a < L.length - 2 && z > L[a + 1]) a++;
  const t = Math.min(1, Math.max(0, (z - L[a]) / (L[a + 1] - L[a])));
  const mix = (arr: Float32Array[]) => arr[a][k] * (1 - t) + arr[a + 1][k] * t;
  return { u: mix(f.u), v: mix(f.v), fu: mix(f.fu), fv: mix(f.fv), ground: f.heights[k] };
}

/**
 * Disturbance 0–1 = how much the flow differs from the unobstructed wind:
 * vector difference relative to the free-stream speed (captures both slowing
 * and turning). 0 = undisturbed, 1 = stopped or fully redirected.
 */
export function disturbanceOf(s: Sample): number {
  const free = Math.hypot(s.fu, s.fv);
  if (free < 1e-3) return 0;
  return Math.min(1, Math.hypot(s.u - s.fu, s.v - s.fv) / free);
}

/** Deterministic PRNG so the streamline layout is stable between rebuilds. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Trace streamlines through the layered field. Seeds are jittered over the
 * grid at several heights; lines follow the horizontal flow, climb when a
 * taller building is ahead, are pushed over roofs, and relax back towards
 * their seed height in the open. Output is split into short chunks so each
 * chunk can carry its own disturbance colour and pulse phase.
 */
export function traceStreamlines(f: Field3D, opts: { seedHeights: number[]; seedsPerHeight: number; maxSteps: number; chunk: number }): Streamlines {
  const { grid } = f;
  const ds = grid.cellSize * 1.5;
  const lookAhead = Math.max(30, ds * 6);
  const coords: number[] = [];
  const offsets: number[] = [0];
  const dist: number[] = [];
  const seq: number[] = [];
  const lvl: number[] = [];
  const rand = rng(42);
  const widthM = grid.width * grid.cellSize;
  const heightM = grid.height * grid.cellSize;
  const side = Math.ceil(Math.sqrt(opts.seedsPerHeight));

  opts.seedHeights.forEach((h0, li) => {
    for (let a = 0; a < side; a++) {
      for (let b = 0; b < side; b++) {
        let x = grid.xmin + ((a + rand()) / side) * widthM;
        let y = grid.ymax - ((b + rand()) / side) * heightM;
        let z = h0;
        const line: number[] = [];
        const lineDist: number[] = [];
        for (let step = 0; step < opts.maxSteps; step++) {
          const s = sampleField(f, x, y, z);
          if (!s) break;
          if (s.ground >= z) z = s.ground + 3; // pushed over the roof
          const speed = Math.hypot(s.u, s.v);
          if (speed < 0.05) break;
          line.push(x, y, z);
          lineDist.push(disturbanceOf(s));
          const dx = s.u / speed;
          const dy = s.v / speed;
          const ahead = sampleField(f, x + dx * lookAhead, y + dy * lookAhead, z);
          let climb = (h0 - z) * 0.05; // relax towards seed height
          if (ahead && ahead.ground > z) climb = Math.min(ds * 0.8, (ahead.ground - z) * 0.25 + 1);
          x += dx * ds;
          y += dy * ds;
          z = Math.max(1, z + climb);
        }
        const verts = line.length / 3;
        if (verts < opts.chunk + 1) continue;
        // Split into overlapping chunks (shared end vertex keeps the line continuous).
        for (let c = 0, ci = 0; c < verts - 1; c += opts.chunk, ci++) {
          const end = Math.min(verts - 1, c + opts.chunk);
          let d = 0;
          for (let k = c; k <= end; k++) {
            coords.push(line[k * 3], line[k * 3 + 1], line[k * 3 + 2]);
            d += lineDist[k];
          }
          offsets.push(offsets[offsets.length - 1] + (end - c + 1));
          dist.push(d / (end - c + 1));
          seq.push(ci);
          lvl.push(li);
        }
      }
    }
  });

  return {
    coords: new Float32Array(coords),
    offsets: new Uint32Array(offsets),
    disturbance: new Float32Array(dist),
    sequence: new Uint16Array(seq),
    seedLevel: new Uint8Array(lvl),
  };
}

export interface ProbeLevel {
  level: number;
  speed: number;
  direction: number | null;
  freeSpeed: number;
  disturbance: number;
  insideBuilding: boolean;
}

/** Wind at one location for every level (for the point probe). */
export function probe(f: Field3D, x: number, y: number): ProbeLevel[] | null {
  const rows: ProbeLevel[] = [];
  for (const level of f.levels) {
    const s = sampleField(f, x, y, level);
    if (!s) return null;
    const speed = Math.hypot(s.u, s.v);
    rows.push({
      level,
      speed,
      // Meteorological "from" direction.
      direction: speed > 0.01 ? ((Math.atan2(-s.u, -s.v) * 180) / Math.PI + 360) % 360 : null,
      freeSpeed: Math.hypot(s.fu, s.fv),
      disturbance: disturbanceOf(s),
      insideBuilding: s.ground > level,
    });
  }
  return rows;
}

export { profileFactor };
