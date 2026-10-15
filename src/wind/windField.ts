import type { Obstacle } from "./obstacles";
import type { WindStats } from "./state";

/**
 * Simplified urban wind model (diagnostic, not CFD):
 *  1. free-stream wind at 10 m = IDW of the weather points (u/v components)
 *  2. inside building footprints the wind is 0
 *  3. wake / shelter: wind is reduced behind obstacles, scaled by obstacle
 *     height ÷ distance looking upwind (porous trees block less)
 *  4. deflection: the component pointing into a rising obstacle is removed,
 *     so the flow slides around buildings
 *  5. trees slow the wind inside their crowns
 */

export interface Grid {
  /** Web Mercator metres. */
  xmin: number;
  ymax: number;
  cellSize: number;
  width: number;
  height: number;
}

export interface BasePoint {
  x: number;
  y: number;
  /** m/s towards east / north (direction the air moves to). */
  u: number;
  v: number;
}

export interface WindFieldResult {
  u: Float32Array<ArrayBuffer>;
  v: Float32Array<ArrayBuffer>;
  /** 1 = open air, 0 = inside a building (no particles). */
  mask: Uint8Array<ArrayBuffer>;
  stats: WindStats;
}

const WAKE_STRENGTH = 2.5;
/** Urban aerodynamic roughness length (m) for the logarithmic wind profile. */
const Z0 = 0.5;

/** Wind speed at height z relative to the 10 m reference (log law), floored at 2 m. */
export function profileFactor(z: number): number {
  return Math.log(Math.max(2, z) / Z0) / Math.log(10 / Z0);
}
const WAKE_DISTANCE_M = 600;
const MAX_WAKE_SAMPLES = 80;

/** Rasterize obstacles taller than `level`; heights are stored relative to that level. */
export function rasterize(grid: Grid, obstacles: Obstacle[], level = 0) {
  const { width: w, height: h, cellSize: cs, xmin, ymax } = grid;
  const H = new Float32Array(w * h);
  const P = new Float32Array(w * h);
  for (const src of obstacles) {
    if (src.height <= level) continue;
    const o = level ? { ...src, height: src.height - level } : src;
    const i0 = Math.max(0, Math.floor((o.xmin - xmin) / cs));
    const i1 = Math.min(w - 1, Math.floor((o.xmax - xmin) / cs));
    const j0 = Math.max(0, Math.floor((ymax - o.ymax) / cs));
    const j1 = Math.min(h - 1, Math.floor((ymax - o.ymin) / cs));
    if (i0 > i1 || j0 > j1) {
      // Obstacle smaller than one cell: mark the cell containing its centre.
      const i = Math.floor(((o.xmin + o.xmax) / 2 - xmin) / cs);
      const j = Math.floor((ymax - (o.ymin + o.ymax) / 2) / cs);
      if (i < 0 || j < 0 || i >= w || j >= h) continue;
      const k = j * w + i;
      H[k] = Math.max(H[k], o.height);
      P[k] = Math.max(P[k], o.porosity * 0.5);
      continue;
    }
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * w + i;
        if (o.height > H[k]) H[k] = o.height;
        if (o.porosity > P[k]) P[k] = o.porosity;
      }
    }
  }
  return { H, P };
}

/** Separable box blur (radius r cells). */
function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[j * w + Math.min(w - 1, Math.max(0, i))];
    for (let i = 0; i < w; i++) {
      tmp[j * w + i] = acc / (2 * r + 1);
      acc += src[j * w + Math.min(w - 1, i + r + 1)] - src[j * w + Math.max(0, i - r)];
    }
  }
  for (let i = 0; i < w; i++) {
    let acc = 0;
    for (let j = -r; j <= r; j++) acc += tmp[Math.min(h - 1, Math.max(0, j)) * w + i];
    for (let j = 0; j < h; j++) {
      out[j * w + i] = acc / (2 * r + 1);
      acc += tmp[Math.min(h - 1, j + r + 1) * w + i] - tmp[Math.max(0, j - r) * w + i];
    }
  }
  return out;
}

/**
 * Wind field at `level` metres above ground. Only obstacles taller than the
 * level block the flow; the free-stream speed follows the log profile.
 */
export function computeWindField(
  grid: Grid,
  base: BasePoint[],
  obstacles: Obstacle[],
  buildingEffect: boolean,
  level = 10,
  /** Precomputed unscaled 10 m free-stream field (skips the IDW when computing many levels). */
  freeRef?: { u: Float32Array; v: Float32Array },
): WindFieldResult {
  const { width: w, height: h, cellSize: cs, xmin, ymax } = grid;
  const pf = profileFactor(level);
  const n = w * h;
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  const mask = new Uint8Array(n).fill(1);

  // 1. Free-stream field (IDW, power 2).
  if (freeRef) {
    for (let k = 0; k < n; k++) {
      u[k] = freeRef.u[k] * pf;
      v[k] = freeRef.v[k] * pf;
    }
  } else for (let j = 0; j < h; j++) {
    const y = ymax - (j + 0.5) * cs;
    for (let i = 0; i < w; i++) {
      const x = xmin + (i + 0.5) * cs;
      let su = 0;
      let sv = 0;
      let sw = 0;
      for (const p of base) {
        const d2 = (p.x - x) ** 2 + (p.y - y) ** 2 + 1;
        const wt = 1 / d2;
        su += wt * p.u;
        sv += wt * p.v;
        sw += wt;
      }
      u[j * w + i] = (su / sw) * pf;
      v[j * w + i] = (sv / sw) * pf;
    }
  }

  let freeSum = 0;
  let openSum = 0;
  let open = 0;
  let calm = 0;
  let buildingCells = 0;

  if (!buildingEffect || !obstacles.some((o) => o.height > level)) {
    for (let k = 0; k < n; k++) freeSum += Math.hypot(u[k], v[k]);
    const freeSpeed = freeSum / n;
    return { u, v, mask, stats: { speedRatio: 1, calmShare: 0, freeSpeed, buildingCells: 0 } };
  }

  const { H, P } = rasterize(grid, obstacles, level);
  const Hb = blur(H, w, h, Math.max(1, Math.round(20 / cs)));
  const steps = Math.ceil(WAKE_DISTANCE_M / cs);
  const stride = Math.max(1, Math.ceil(steps / MAX_WAKE_SAMPLES));
  const u0 = u.slice();
  const v0 = v.slice();

  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const fu = u0[k];
      const fv = v0[k];
      const free = Math.hypot(fu, fv);
      if (P[k] >= 0.99) {
        u[k] = 0;
        v[k] = 0;
        mask[k] = 0;
        buildingCells++;
        continue;
      }
      freeSum += free;
      let uu = fu;
      let vv = fv;

      // 3. Wake: look upwind for the strongest height/distance ratio.
      if (free > 0.01) {
        const dx = fu / free; // +x = east
        const dy = -fv / free; // +j = south
        let shelter = 0;
        for (let s = 1; s <= steps; s += s < 4 ? 1 : stride) {
          const ii = Math.round(i - dx * s);
          const jj = Math.round(j - dy * s);
          if (ii < 0 || jj < 0 || ii >= w || jj >= h) break;
          const kk = jj * w + ii;
          if (H[kk] > 0) {
            const r = (H[kk] * P[kk]) / (s * cs);
            if (r > shelter) shelter = r;
          }
        }
        const factor = 1 / (1 + WAKE_STRENGTH * shelter);
        uu *= factor;
        vv *= factor;
      }

      // 4. Deflection around rising obstacles.
      if (i > 0 && j > 0 && i < w - 1 && j < h - 1) {
        const gx = (Hb[k + 1] - Hb[k - 1]) / (2 * cs);
        const gy = (Hb[k - w] - Hb[k + w]) / (2 * cs); // north positive
        const g = Math.hypot(gx, gy);
        if (g > 0.02) {
          const nx = gx / g;
          const ny = gy / g;
          const into = uu * nx + vv * ny;
          if (into > 0) {
            const strength = Math.min(1, g * 2);
            uu -= into * nx * strength;
            vv -= into * ny * strength;
          }
        }
      }

      // 5. Inside tree crowns.
      if (P[k] > 0) {
        uu *= 1 - 0.5 * P[k];
        vv *= 1 - 0.5 * P[k];
      }

      u[k] = uu;
      v[k] = vv;
      const sp = Math.hypot(uu, vv);
      openSum += sp;
      open++;
      if (sp < 0.5 * free) calm++;
    }
  }

  return {
    u,
    v,
    mask,
    stats: {
      speedRatio: freeSum > 0 ? openSum / freeSum : 1,
      calmShare: open ? calm / open : 0,
      freeSpeed: open ? freeSum / open : 0,
      buildingCells,
    },
  };
}
