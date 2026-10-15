import Camera from "@arcgis/core/Camera";
import Map from "@arcgis/core/Map";
import Viewpoint from "@arcgis/core/Viewpoint";
import WebMap from "@arcgis/core/WebMap";
import Extent from "@arcgis/core/geometry/Extent";
import type Point from "@arcgis/core/geometry/Point";
import type Layer from "@arcgis/core/layers/Layer";
import Bookmark from "@arcgis/core/webmap/Bookmark";
import { areas, config, type Area } from "./config";

export type Mode = "3d" | "2d";

export interface Views {
  mode: Mode;
  /** Operational layers loaded from the web map (empty if it failed to load). */
  layers: Layer[];
  webmapError: string | null;
  /** Loads the web map (and adds its layers to the 3D scene). Safe to call again after signing in. */
  loadWebmap(): Promise<void>;
  /** Calls cb once the web map has loaded (immediately if it already has). */
  onWebmapLoaded(cb: () => void): void;
  setMode(mode: Mode): void;
  goToArea(area: Area): Promise<void>;
  onModeChange(cb: (mode: Mode) => void): void;
  /**
   * The ArcGIS AI assistant only works on the 2D map. In 3D mode, call beginAssistantTurn() when the
   * user sends a message (2D map takes over the 3D location) and endAssistantTurn() after the answer
   * (3D scene follows if the assistant moved the map).
   */
  beginAssistantTurn(): void;
  endAssistantTurn(): void;
}

export const areaCamera = (a: Area) =>
  new Camera({
    position: { longitude: a.center[0], latitude: a.center[1] - a.camera.offsetLat, z: a.camera.z },
    heading: a.camera.heading,
    tilt: a.camera.tilt,
  });

const areaExtent = (a: Area) => {
  const [xmin, ymin, xmax, ymax] = a.extent;
  return new Extent({ xmin, ymin, xmax, ymax, spatialReference: { wkid: 4326 } });
};

/** Bookmarks SCBD and PIK: an extent (used in 2D) plus a tilted camera (used in 3D). */
export const areaBookmarks = () =>
  areas.map(
    (a) =>
      new Bookmark({
        name: a.name,
        viewpoint: new Viewpoint({ targetGeometry: areaExtent(a), camera: areaCamera(a) }),
      }),
  );

/**
 * The web map drives the 2D view; the 3D scene (set up by main.ts, shared with the air-quality
 * modules) gets copies of its operational layers (a layer instance cannot live in two maps).
 * Call once the scene view is ready.
 */
export function createViews(): Views {
  const sceneEl = document.getElementById("scene") as HTMLArcgisSceneElement;
  const mapEl = document.getElementById("map") as HTMLArcgisMapElement;
  const map3d = sceneEl.view.map!;

  // Start on a plain basemap so the UI never waits on the (possibly private) web map.
  mapEl.map = new Map({ basemap: config.fallbackBasemap2d });
  mapEl.extent = areaExtent(areas[0]);

  // The 2D map is never display:none: it stays laid out (invisible) while in 3D so the AI assistant can use it.
  const showMode = (mode: Mode) => {
    sceneEl.hidden = mode !== "3d";
    mapEl.classList.toggle("is-offscreen", mode !== "2d");
  };

  const copyView = async (from: { center: Point; scale: number }, to: { goTo(t: unknown, o?: unknown): Promise<unknown> }, animate: boolean) =>
    to.goTo({ center: from.center.clone(), scale: from.scale }, { animate, duration: 1500 }).catch(() => undefined);

  let turnStart: { x: number; y: number; scale: number } | null = null;

  let loaded = false;
  const loadedListeners: (() => void)[] = [];
  const listeners: ((m: Mode) => void)[] = [];
  const views: Views = {
    mode: "3d",
    layers: [],
    webmapError: null,
    loadWebmap: async () => undefined,
    onWebmapLoaded: (cb) => (loaded ? cb() : loadedListeners.push(cb)),
    onModeChange: (cb) => listeners.push(cb),
    setMode(mode) {
      if (mode === views.mode) return;
      // Carry the current location over to the view being shown.
      const from = mode === "2d" ? sceneEl.view : mapEl.view;
      const snapshot = from.center ? { center: from.center.clone(), scale: from.scale } : null;
      views.mode = mode;
      showMode(mode);
      listeners.forEach((cb) => cb(mode));
      if (snapshot) void copyView(snapshot, mode === "2d" ? mapEl.view : sceneEl.view, false);
    },
    async goToArea(a) {
      if (views.mode === "3d") await sceneEl.view.goTo(areaCamera(a), { duration: 2500 }).catch(() => undefined);
      else await mapEl.viewOnReady().then(() => mapEl.view.goTo(areaExtent(a), { duration: 1500 })).catch(() => undefined);
    },
    beginAssistantTurn() {
      if (views.mode !== "3d") return;
      const c = sceneEl.view.center;
      void copyView({ center: c, scale: sceneEl.view.scale }, mapEl.view, false).then(() => {
        turnStart = { x: mapEl.view.center.x, y: mapEl.view.center.y, scale: mapEl.view.scale };
      });
    },
    endAssistantTurn() {
      if (views.mode !== "3d" || !turnStart) return;
      const c = mapEl.view.center;
      const moved = Math.hypot(c.x - turnStart.x, c.y - turnStart.y) > turnStart.scale * 0.0005 || Math.abs(Math.log(mapEl.view.scale / turnStart.scale)) > 0.05;
      turnStart = null;
      if (moved) void copyView({ center: c, scale: mapEl.view.scale }, sceneEl.view, true);
    },
  };
  // Load the web map in the background: 2D swaps to it, 3D gets copies of its layers.
  // Never prompts: a private item fails with webmapError until the user signs in (OAuth).
  views.loadWebmap = async () => {
    if (loaded) return;
    try {
      const webmap = new WebMap({ portalItem: { id: config.webmapId, portal: { url: config.portalUrl } } });
      await webmap.loadAll();
      loaded = true;
      views.webmapError = null;
      views.layers = webmap.layers.toArray();
      for (const l of views.layers) {
        // config.json kawasan.webmapLayers: visibility by layer title (2D and 3D).
        if (l.title && l.title in config.webmapLayers) l.visible = config.webmapLayers[l.title];
        const copy = (l as Layer & { clone(): Layer }).clone() as Layer & { elevationInfo?: unknown };
        // Ground-draped polygons are hidden by the 3D basemap; draw them just above the ground instead.
        if ("elevationInfo" in copy) copy.elevationInfo = { mode: "relative-to-ground", offset: config.layerOffset3d };
        map3d.add(copy);
      }
      // SCBD and PIK are also web map bookmarks, so the AI navigation agent can "go to SCBD".
      webmap.bookmarks.addMany(areaBookmarks());
      const keep = mapEl.view.center ? { center: mapEl.view.center.clone(), scale: mapEl.view.scale } : null;
      mapEl.map = webmap;
      if (keep) await mapEl.viewOnReady().then(() => copyView(keep, mapEl.view, false));
      loadedListeners.splice(0).forEach((cb) => cb());
    } catch (err) {
      views.webmapError = err instanceof Error ? err.message : String(err);
      console.warn("Web map gagal dimuat", err);
    }
  };
  showMode("3d");
  return views;
}
