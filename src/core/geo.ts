/** Small geometry helpers that work in WGS84 degrees (fine at city scale). */

export type Ring = [number, number][];

export function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface WeightedPoint {
  x: number;
  y: number;
  value: number;
}

/** Inverse-distance-weighted interpolation (power 2). */
export function idw(x: number, y: number, points: WeightedPoint[], power = 2): number | null {
  let num = 0;
  let den = 0;
  for (const p of points) {
    const d2 = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d2 < 1e-12) return p.value;
    const w = 1 / Math.pow(d2, power / 2);
    num += w * p.value;
    den += w;
  }
  return den ? num / den : null;
}

/** Load the first polygon ring of a GeoJSON FeatureCollection (or null if unavailable). */
export async function loadBoundaryRing(url: string): Promise<Ring | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const gj = await res.json();
    const geom = gj.features?.[0]?.geometry ?? gj.geometry ?? gj;
    if (geom?.type === "Polygon") return geom.coordinates[0];
    if (geom?.type === "MultiPolygon") return geom.coordinates[0][0];
  } catch (err) {
    console.warn("Boundary not loaded", err);
  }
  return null;
}

const R = 6378137;

/** WGS84 → Web Mercator (metres). */
export function toMercator(lon: number, lat: number): [number, number] {
  const x = (lon * Math.PI * R) / 180;
  const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return [x, y];
}

/** Web Mercator (metres) → WGS84. */
export function fromMercator(x: number, y: number): [number, number] {
  const lon = (x / R) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);
  return [lon, lat];
}
