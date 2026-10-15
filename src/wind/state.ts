import { Store } from "../core/store";
import type { ProbeLevel } from "./wind3d";

/** A hypothetical building placed by the user to test its effect on the wind. */
export interface WhatIfBuilding {
  id: string;
  longitude: number;
  latitude: number;
  heightM: number;
  sizeM: number;
}

export interface WindStats {
  /** Mean speed with obstacles / mean free-stream speed (non-building cells). */
  speedRatio: number;
  /** Share of open cells where wind is below half the free-stream speed. */
  calmShare: number;
  /** Free-stream mean speed (m/s) at the animated level. */
  freeSpeed: number;
  buildingCells: number;
}

export interface WindProbe {
  longitude: number;
  latitude: number;
  rows: ProbeLevel[];
  /** Timeline time the probe was computed for. */
  time: number;
}

export interface WindState {
  /** Height (m) of the animated particle layer. */
  animLevel: number;
  whatIf: WhatIfBuilding[];
  placeHeight: number;
  placeSize: number;
  density: number;
  flowSpeed: number;
  trailLength: number;
  stats: WindStats | null;
  /** Number of real buildings read from the scene for the current grid. */
  sceneBuildings: number;
  /** Obstacles from objects added through the Add data menu. */
  addedObstacles: number;
  streamlineCount: number;
  gridInfo: string;
  probe: WindProbe | null;
  /** Level (m) shown in the probe chart. */
  probeLevel: number;
}

export const windStore = new Store<WindState>({
  animLevel: 10,
  whatIf: [],
  placeHeight: 150,
  placeSize: 50,
  density: 1,
  flowSpeed: 20,
  trailLength: 400,
  stats: null,
  sceneBuildings: 0,
  addedObstacles: 0,
  streamlineCount: 0,
  gridInfo: "",
  probe: null,
  probeLevel: 10,
});

/**
 * Disturbance colour scale (weak → strong), matching the "wind fluid
 * disturbance" convention of city wind simulations: violet/blue = flow close
 * to the undisturbed wind, red = strongly slowed or redirected by buildings.
 */
export const DISTURBANCE_STOPS: { value: number; color: string; label?: string }[] = [
  { value: 0, color: "#6a3df0", label: "Gangguan lemah" },
  { value: 0.15, color: "#2f63ff" },
  { value: 0.3, color: "#12b8e6" },
  { value: 0.45, color: "#22c55e", label: "Sedang" },
  { value: 0.6, color: "#e6e01a" },
  { value: 0.8, color: "#ff8a1a" },
  { value: 1, color: "#ff2a2a", label: "Gangguan kuat" },
];
