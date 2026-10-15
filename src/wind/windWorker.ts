/// <reference lib="webworker" />
import type { Obstacle } from "./obstacles";
import { computeField3D, traceStreamlines, type Field3D, type Streamlines } from "./wind3d";
import { computeWindField, type BasePoint, type Grid, type WindFieldResult } from "./windField";

export interface WindJob {
  id: number;
  grid: Grid;
  base: BasePoint[];
  obstacles: Obstacle[];
  buildingEffect: boolean;
  /** Height of the animated FlowRenderer layer. */
  animLevel: number;
  /** When set, also compute the layered 3D field and trace streamlines on this (coarser) grid. */
  field3d?: { grid: Grid; seedHeights: number[]; seedsPerHeight: number; maxSteps: number; chunk: number };
}

export interface WindJobResult extends WindFieldResult {
  id: number;
  field3d?: Field3D;
  streamlines?: Streamlines;
}

self.onmessage = (e: MessageEvent<WindJob>) => {
  const { id, grid, base, obstacles, buildingEffect, animLevel, field3d } = e.data;
  const r = computeWindField(grid, base, obstacles, buildingEffect, animLevel);
  const out: WindJobResult = { id, ...r };
  const transfer: Transferable[] = [r.u.buffer, r.v.buffer, r.mask.buffer];
  if (field3d) {
    const f = computeField3D(field3d.grid, base, obstacles, buildingEffect);
    const sl = traceStreamlines(f, field3d);
    out.field3d = f;
    out.streamlines = sl;
    for (const a of [...f.u, ...f.v, ...f.fu, ...f.fv, f.heights]) transfer.push(a.buffer);
    transfer.push(sl.coords.buffer, sl.offsets.buffer, sl.disturbance.buffer, sl.sequence.buffer, sl.seedLevel.buffer);
  }
  (self as unknown as Worker).postMessage(out, transfer);
};
