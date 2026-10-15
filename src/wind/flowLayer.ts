import Graphic from "@arcgis/core/Graphic";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import Extent from "@arcgis/core/geometry/Extent";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import Polyline from "@arcgis/core/geometry/Polyline";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import ImageryTileLayer from "@arcgis/core/layers/ImageryTileLayer";
import PixelBlock from "@arcgis/core/layers/support/PixelBlock";
import FeatureFilter from "@arcgis/core/layers/support/FeatureFilter";
import FlowRenderer from "@arcgis/core/renderers/FlowRenderer";
import type FeatureLayerView from "@arcgis/core/views/layers/FeatureLayerView";
import { fromMercator, toMercator } from "../core/geo";
import type { LayerModule } from "../core/modules";
import { weatherAt } from "../core/selectors";
import { greeningStore } from "../greening/state";
import { collectObstacles, onObstaclesChanged } from "../core/obstacleSources";
import { sceneBuildingObstacles, treeObstacles, whatIfObstacles, type Obstacle } from "./obstacles";
import { DISTURBANCE_STOPS, windStore } from "./state";
import { LEVELS, probe, type Field3D, type Streamlines } from "./wind3d";
import type { BasePoint, Grid } from "./windField";
import type { WindJob, WindJobResult } from "./windWorker";

/** Run the wind model off the main thread. */
const worker = new Worker(new URL("./windWorker.ts", import.meta.url), { type: "module" });
let jobId = 0;
const pending = new Map<number, (r: WindJobResult) => void>();
worker.onmessage = (e: MessageEvent<WindJobResult>) => {
  pending.get(e.data.id)?.(e.data);
  pending.delete(e.data.id);
};
function computeInWorker(job: Omit<WindJob, "id">): Promise<WindJobResult> {
  const id = ++jobId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.postMessage({ id, ...job });
  });
}

const CITY_CELL = 60; // m, whole-city grid
const DETAIL_MAX_ALTITUDE = 6000; // m camera height below which the local fine grid is used
const DETAIL_PIXELS = 640;
const FIELD3D_PIXELS = 300;
const PULSE_PHASES = 10;
const PULSE_INTERVAL_MS = 140;
/** While the timeline plays, the (heavier) 3D streamlines refresh at most this often. */
const FIELD3D_PLAYING_INTERVAL_MS = 3000;

const SR = SpatialReference.WebMercator;

const disturbanceVariable = () => ({
  type: "color" as const,
  field: "dist",
  stops: DISTURBANCE_STOPS.map((s) => ({ value: s.value, color: s.color, label: s.label })),
});

/**
 * City wind simulation, modelled on urban digital-twin wind views:
 *  - animated particles (FlowRenderer) at a chosen height, coloured by disturbance
 *  - traced 3D streamlines that flow between and over buildings, coloured by
 *    disturbance, with a pulse travelling along them
 *  - point probe: wind per height at a clicked location
 * Inputs: BMKG wind (forecast hours) / Open-Meteo (history), buildings from the
 * visible 3D layers, objects added through the Add data menu (registered
 * obstacle sources: placed models, CityJSON, extruded polygons), what-if
 * buildings and planted trees.
 */
export function createFlowLayer(): LayerModule {
  let visible = false;
  let flow: ImageryTileLayer | null = null;
  let lines: FeatureLayer | null = null;
  let pulse: FeatureLayer | null = null;
  let pulseView: FeatureLayerView | null = null;
  let field3d: Field3D | null = null;
  let requestBuild: (with3d?: boolean) => void = () => {};
  let teardown: () => void = () => {};
  const whatIfLayer = new GraphicsLayer({ title: "Gedung what-if", elevationInfo: { mode: "on-the-ground" } });
  const probeLayer = new GraphicsLayer({ title: "Titik probe angin", elevationInfo: { mode: "relative-to-ground" } });

  const applyVisibility = () => {
    if (flow) flow.visible = visible;
    if (lines) lines.visible = visible;
    if (pulse) pulse.visible = visible;
    whatIfLayer.visible = visible;
    probeLayer.visible = visible;
  };

  return {
    id: "wind-flow",
    title: "Simulasi angin 3D",
    description: "Partikel & streamline 3D berwarna tingkat gangguan angin oleh gedung. Data BMKG (prakiraan) / Open-Meteo (historis).",
    visibleByDefault: false,
    legend: DISTURBANCE_STOPS.filter((s) => s.label).map((s) => ({ label: s.label!, color: s.color })),

    init({ map, view, store, config }) {
      map.addMany([whatIfLayer, probeLayer]);
      let obstacles: Obstacle[] = [];
      let obstaclesKey = "";
      let rebuildTimer = 0;
      let lastBuild = 0;
      let last3d = 0;
      let building = 0;

      const chooseGrid = (): { grid: Grid; key: string; extent: Extent; detail: boolean } => {
        const z = view.camera?.position?.z ?? Infinity;
        if (z < DETAIL_MAX_ALTITUDE && view.center) {
          const [cx, cy] = toMercator(view.center.longitude!, view.center.latitude!);
          const half = Math.min(3000, Math.max(500, z * 0.9));
          const cs = Math.max(3, (2 * half) / DETAIL_PIXELS);
          const w = Math.round((2 * half) / cs);
          const grid = { xmin: cx - half, ymax: cy + half, cellSize: cs, width: w, height: w };
          const extent = new Extent({ xmin: cx - half, ymin: cy - half, xmax: cx + half, ymax: cy + half, spatialReference: SR });
          return { grid, extent, detail: true, key: `d|${Math.round(cx / 200)}|${Math.round(cy / 200)}|${Math.round(half / 100)}` };
        }
        const [x0, y0] = toMercator(config.extent[0] - 0.03, config.extent[1] - 0.03);
        const [x1, y1] = toMercator(config.extent[2] + 0.03, config.extent[3] + 0.03);
        const w = Math.round((x1 - x0) / CITY_CELL);
        const h = Math.round((y1 - y0) / CITY_CELL);
        const grid = { xmin: x0, ymax: y1, cellSize: CITY_CELL, width: w, height: h };
        const extent = new Extent({ xmin: x0, ymin: y1 - h * CITY_CELL, xmax: x0 + w * CITY_CELL, ymax: y1, spatialReference: SR });
        return { grid, extent, detail: false, key: "city" };
      };

      const basePoints = (): BasePoint[] => {
        const samples = weatherAt(store.state);
        return config.weatherLocations.flatMap((loc) => {
          const w = samples[loc.id];
          if (w?.windSpeed == null || w.windDirection == null) return [];
          const to = ((w.windDirection + 180) * Math.PI) / 180;
          const [x, y] = toMercator(loc.longitude, loc.latitude);
          return [{ x, y, u: Math.sin(to) * w.windSpeed, v: Math.cos(to) * w.windSpeed }];
        });
      };

      /** Particles are coloured by disturbance too: speed relative to the free-stream speed at that height. */
      const flowRenderer = (freeSpeed: number) => {
        const s = windStore.state;
        const free = Math.max(0.3, freeSpeed);
        const stops = [...DISTURBANCE_STOPS]
          .reverse()
          .map((d) => ({ value: free * (1 - d.value), color: d.color }));
        stops.push({ value: free * 1.3, color: DISTURBANCE_STOPS[0].color });
        return new FlowRenderer({
          density: s.density,
          flowSpeed: s.flowSpeed,
          trailLength: s.trailLength,
          trailWidth: "2.5px",
          flowRepresentation: "flow-to",
          visualVariables: [{ type: "color", field: "Magnitude", stops }],
        });
      };

      const streamlineLayers = (sl: Streamlines) => {
        const make = (pulseLayer: boolean) => {
          const graphics: Graphic[] = [];
          for (let c = 0; c < sl.disturbance.length; c++) {
            const path: number[][] = [];
            for (let k = sl.offsets[c]; k < sl.offsets[c + 1]; k++) path.push([sl.coords[k * 3], sl.coords[k * 3 + 1], sl.coords[k * 3 + 2]]);
            graphics.push(
              new Graphic({
                geometry: new Polyline({ paths: [path], hasZ: true, spatialReference: SR }),
                attributes: { ObjectID: c + 1, dist: sl.disturbance[c], phase: sl.sequence[c] % PULSE_PHASES, lvl: sl.seedLevel[c] },
              }),
            );
          }
          return new FeatureLayer({
            title: pulseLayer ? "Pulsa streamline" : "Streamline angin 3D",
            source: graphics,
            objectIdField: "ObjectID",
            fields: [
              { name: "ObjectID", type: "oid" },
              { name: "dist", type: "double" },
              { name: "phase", type: "integer" },
              { name: "lvl", type: "integer" },
            ],
            geometryType: "polyline",
            hasZ: true,
            spatialReference: SR,
            elevationInfo: { mode: "relative-to-ground" },
            popupEnabled: false,
            listMode: "hide",
            opacity: pulseLayer ? 1 : 0.55,
            renderer: {
              type: "simple",
              symbol: { type: "line-3d", symbolLayers: [{ type: "line", size: pulseLayer ? 3.5 : 1.6, material: { color: "white" }, cap: "round", join: "round" }] },
              visualVariables: [disturbanceVariable()],
            } as never,
          });
        };
        return { base: make(false), pulseLayer: make(true) };
      };

      // Layers per kind, tagged with the build number that produced them. When a layer is
      // ready, older layers of the same kind are removed; a stale layer that finishes after a
      // newer one is discarded.
      type Kind = "flow" | "lines" | "pulse";
      const live: Record<Kind, { layer: FeatureLayer | ImageryTileLayer; run: number; ready: boolean }[]> = { flow: [], lines: [], pulse: [] };
      // Remove (and destroy) a layer only once its layer view has settled: removing one while its
      // view is still being created can leave an orphaned renderer, e.g. FlowRenderer particles
      // that keep animating after the simulation is switched off.
      const discard = (layer: FeatureLayer | ImageryTileLayer) => {
        void view
          .whenLayerView(layer)
          .catch(() => undefined)
          .finally(() =>
            setTimeout(() => {
              map.remove(layer);
              layer.destroy();
            }, 300),
          );
      };
      const swap = async (kind: Kind, next: FeatureLayer | ImageryTileLayer, run: number) => {
        // A build that finished after the simulation was switched off (or superseded) is dropped.
        if (!visible || run !== building) {
          next.destroy();
          return;
        }
        next.visible = visible;
        const entry = { layer: next, run, ready: false };
        live[kind].push(entry);
        map.add(next);
        try {
          await view.whenLayerView(next);
        } catch (err) {
          console.warn("Wind layer failed", err);
        }
        entry.ready = true;
        const newest = Math.max(...live[kind].filter((e) => e.ready).map((e) => e.run));
        const keep: typeof live[Kind] = [];
        for (const e of live[kind]) {
          if (e.run === newest || (!e.ready && e.run > newest)) keep.push(e);
          else discard(e.layer);
        }
        live[kind] = keep;
        const current = keep.find((e) => e.run === newest)?.layer ?? null;
        if (kind === "flow") flow = current as ImageryTileLayer | null;
        if (kind === "lines") lines = current as FeatureLayer | null;
        if (kind === "pulse") {
          pulse = current as FeatureLayer | null;
          pulseView = pulse ? ((await view.whenLayerView(pulse).catch(() => null)) as FeatureLayerView | null) : null;
        }
      };

      /** Remove every particle/streamline layer (current and in-flight builds). */
      const clearLayers = () => {
        for (const k of ["flow", "lines", "pulse"] as Kind[]) {
          live[k].forEach((e) => discard(e.layer));
          live[k] = [];
        }
        flow = lines = pulse = null;
        pulseView = null;
      };
      teardown = () => {
        building++; // in-flight builds see a newer run number and stop
        window.clearTimeout(rebuildTimer);
        clearLayers();
      };

      const build = async (force3d = false) => {
        if (!visible) return;
        const run = ++building;
        const base = basePoints();
        if (!base.length) {
          clearLayers();
          return;
        }
        const { grid, extent, detail, key } = chooseGrid();
        const ws = windStore.state;

        // Real buildings are only read for the fine local grid (where they matter and are loaded).
        if (detail && key !== obstaclesKey) {
          obstacles = await sceneBuildingObstacles(view, extent).catch(() => []);
          obstaclesKey = key;
        } else if (!detail) {
          obstacles = [];
          obstaclesKey = "";
        }
        if (run !== building) return;

        // Objects from the Add data menu block the wind at every grid level.
        const added = await collectObstacles(extent).catch(() => []);
        if (run !== building) return;
        const g = greeningStore.state;
        const all = [...obstacles, ...added, ...whatIfObstacles(ws.whatIf), ...treeObstacles(g.plantings, g.species)];

        const now = performance.now();
        const want3d = force3d || !store.state.playing || now - last3d > FIELD3D_PLAYING_INTERVAL_MS;
        const cs3 = Math.max(grid.cellSize * 2, (grid.width * grid.cellSize) / FIELD3D_PIXELS);
        const grid3 = { xmin: grid.xmin, ymax: grid.ymax, cellSize: cs3, width: Math.round((grid.width * grid.cellSize) / cs3), height: Math.round((grid.height * grid.cellSize) / cs3) };

        const result = await computeInWorker({
          grid,
          base,
          obstacles: all,
          buildingEffect: true,
          animLevel: ws.animLevel,
          field3d: want3d
            ? { grid: grid3, seedHeights: detail ? [5, 20, 45, 80, 130] : [15, 60, 150], seedsPerHeight: detail ? 160 : 220, maxSteps: detail ? 160 : 120, chunk: 6 }
            : undefined,
        });
        if (run !== building) return;
        if (result.field3d) {
          field3d = result.field3d;
          last3d = now;
        }

        windStore.set({
          stats: result.stats,
          sceneBuildings: obstacles.length,
          addedObstacles: added.length,
          streamlineCount: result.streamlines ? result.streamlines.disturbance.length : windStore.state.streamlineCount,
          gridInfo: detail ? `Grid detail ${grid.width}×${grid.height} @ ${grid.cellSize.toFixed(1)} m · 3D ${grid3.width}² × ${LEVELS.length} lapis` : `Grid kota ${grid.width}×${grid.height} @ ${CITY_CELL} m`,
        });

        const pixelBlock = new PixelBlock({
          width: grid.width,
          height: grid.height,
          pixelType: "f32",
          pixels: [result.u, result.v],
          mask: result.mask,
          statistics: [
            { minValue: -20, maxValue: 20 },
            { minValue: -20, maxValue: 20 },
          ],
        });
        const nextFlow = new ImageryTileLayer({
          title: "Partikel angin",
          // `dataType` marks the two bands as a u/v vector field (read by the in-memory raster).
          source: { extent, pixelBlock, dataType: "vector-uv" } as never,
          renderer: flowRenderer(result.stats.freeSpeed),
          elevationInfo: ws.animLevel > 2 ? { mode: "relative-to-ground", offset: ws.animLevel } : { mode: "on-the-ground" },
          popupEnabled: false,
          listMode: "hide",
        });
        const tasks: Promise<void>[] = [swap("flow", nextFlow, run)];
        if (result.streamlines) {
          const { base: b, pulseLayer } = streamlineLayers(result.streamlines);
          tasks.push(swap("lines", b, run), swap("pulse", pulseLayer, run));
        }
        await Promise.all(tasks);
        applyVisibility();
        lastBuild = performance.now();
        if (windStore.state.probe) updateProbe(windStore.state.probe.longitude, windStore.state.probe.latitude);
      };

      /** Debounce rebuilds; while the timeline plays, rebuild at most once per second. */
      const schedule = (delay = 250, with3d = false) => {
        window.clearTimeout(rebuildTimer);
        const wait = store.state.playing ? Math.max(delay, 1000 - (performance.now() - lastBuild)) : delay;
        rebuildTimer = window.setTimeout(() => void build(with3d), wait);
      };
      requestBuild = (with3d = false) => schedule(0, with3d);

      // Pulse animation along the streamlines.
      let phase = 0;
      window.setInterval(() => {
        if (!pulseView || !pulse?.visible) return;
        phase = (phase + 1) % PULSE_PHASES;
        pulseView.filter = new FeatureFilter({ where: `phase = ${phase}` });
      }, PULSE_INTERVAL_MS);

      store.on(["weather", "timeIndex"], () => schedule());
      store.on(["playing"], (s) => !s.playing && schedule(100, true));
      windStore.on(["density", "flowSpeed", "trailLength"], () => flow && (flow.renderer = flowRenderer(windStore.state.stats?.freeSpeed ?? 2)));
      windStore.on(["whatIf", "animLevel"], () => {
        obstaclesKey = "";
        schedule(50, true);
      });
      onObstaclesChanged(() => schedule(150, true));
      greeningStore.on(["plantings"], () => schedule(250, true));
      // Camera moved: new grid; also give scene layers time to load their buildings.
      reactiveUtils.watch(
        () => view.stationary,
        (stationary) => {
          if (!stationary) return;
          schedule(300, true);
          window.setTimeout(() => {
            obstaclesKey = "";
            schedule(0, true);
          }, 2500);
        },
      );

      // What-if buildings.
      const renderWhatIf = () => {
        whatIfLayer.removeAll();
        whatIfLayer.addMany(
          windStore.state.whatIf.map((b) => {
            const [x, y] = toMercator(b.longitude, b.latitude);
            const half = b.sizeM / 2 / Math.cos((b.latitude * Math.PI) / 180);
            const ring = [
              [x - half, y - half],
              [x - half, y + half],
              [x + half, y + half],
              [x + half, y - half],
              [x - half, y - half],
            ].map(([px, py]) => fromMercator(px, py));
            return new Graphic({
              geometry: new Polygon({ rings: [ring], spatialReference: { wkid: 4326 } }),
              symbol: {
                type: "polygon-3d",
                symbolLayers: [{ type: "extrude", size: b.heightM, material: { color: [235, 238, 242, 0.95] }, edges: { type: "solid", color: [60, 60, 70, 0.6], size: 1 } }],
              } as never,
              attributes: { id: b.id },
            });
          }),
        );
      };
      windStore.on(["whatIf"], renderWhatIf, true);

      // Point probe.
      const updateProbe = (lon: number, lat: number) => {
        if (!field3d) return;
        const [x, y] = toMercator(lon, lat);
        const rows = probe(field3d, x, y);
        if (!rows) return;
        const s = store.state;
        windStore.set({ probe: { longitude: lon, latitude: lat, rows, time: s.airQuality?.times[s.timeIndex] ?? Date.now() } });
      };
      const renderProbe = () => {
        probeLayer.removeAll();
        const p = windStore.state.probe;
        if (!p) return;
        const top = LEVELS[LEVELS.length - 1];
        probeLayer.add(
          new Graphic({
            geometry: new Polyline({ paths: [[[p.longitude, p.latitude, 0], [p.longitude, p.latitude, top]]], hasZ: true, spatialReference: { wkid: 4326 } }),
            symbol: { type: "line-3d", symbolLayers: [{ type: "line", size: 2, material: { color: [255, 255, 255, 0.9] } }] } as never,
          }),
        );
        for (const r of p.rows) {
          const color = DISTURBANCE_STOPS.reduce((acc, st) => (r.disturbance >= st.value ? st.color : acc), DISTURBANCE_STOPS[0].color);
          probeLayer.add(
            new Graphic({
              geometry: new Point({ longitude: p.longitude, latitude: p.latitude, z: r.level }),
              symbol: {
                type: "point-3d",
                symbolLayers: [{ type: "icon", resource: { primitive: "circle" }, size: r.level === windStore.state.probeLevel ? 14 : 9, material: { color }, outline: { color: "white", size: 1 } }],
              } as never,
            }),
          );
        }
      };
      windStore.on(["probe", "probeLevel"], renderProbe);

      view.on("click", (event) => {
        const tool = store.state.mapTool;
        if (!event.mapPoint || (tool !== "place-building" && tool !== "wind-probe")) return;
        event.stopPropagation();
        const lon = event.mapPoint.longitude!;
        const lat = event.mapPoint.latitude!;
        if (tool === "wind-probe") {
          if (field3d) updateProbe(lon, lat);
          else {
            windStore.set({ probe: { longitude: lon, latitude: lat, rows: [], time: Date.now() } });
            requestBuild(true);
          }
          return;
        }
        const s = windStore.state;
        windStore.set({ whatIf: [...s.whatIf, { id: `g${Date.now().toString(36)}`, longitude: lon, latitude: lat, heightM: s.placeHeight, sizeM: s.placeSize }] });
      });

      schedule(500, true);
    },

    setVisible(value) {
      visible = value;
      // Switching off removes the simulation layers instead of only hiding them; they are
      // rebuilt when switched on again.
      if (!value) teardown();
      applyVisibility();
      if (value && !flow) requestBuild(true);
    },
  };
}
