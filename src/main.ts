import "@esri/calcite-components/main.css";
import "@arcgis/map-components/main.css";
import "./styles/main.css";
import "./styles.css";
import "./ui/components";
import "@arcgis/map-components/components/arcgis-map";

import esriConfig from "@arcgis/core/config";
import Basemap from "@arcgis/core/Basemap";
import Camera from "@arcgis/core/Camera";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
import { appConfig } from "./config/app.config";
import { createRegistry } from "./config/modules";
import { loadRuntimeConfig, startup } from "./config/runtimeConfig";
import { areas, config } from "./config";
import { isSignedIn, setupAuth, signIn } from "./auth";
import { DataService } from "./core/dataService";
import type { AppContext } from "./core/modules";
import { Store, type AppState } from "./core/store";
import { defaultRange } from "./core/time";
import { startTimelinePlayer } from "./core/timeline";
import { configureBmkg } from "./providers/weather/bmkg";
import { mountHeader, mountWidgets } from "./ui/shell";
import { mountTimelineDock } from "./ui/timelineDock";
import { createViews, type Mode, type Views } from "./views";

async function bootstrap(): Promise<void> {
  // public/config.json: applied before anything reads the configuration.
  const configProblem = await loadRuntimeConfig();
  if (config.apiKey) esriConfig.apiKey = config.apiKey;
  esriConfig.applicationName = appConfig.title;
  configureBmkg(appConfig.bmkgBaseUrl);
  const authEnabled = setupAuth();

  const registry = createRegistry();
  const unknownLayers = Object.keys(startup.layers).filter((id) => !registry.layers.some((l) => l.id === id));
  if (unknownLayers.length) console.warn(`config.json layers: id tidak dikenal ${unknownLayers.join(", ")}; id yang tersedia: ${registry.layers.map((l) => l.id).join(", ")}`);
  const prefersLight = window.matchMedia?.("(prefers-color-scheme: light)").matches;
  const theme = startup.theme === "auto" ? (prefersLight ? "light" : "dark") : startup.theme;
  const store = new Store<AppState>({
    mode: startup.timeMode,
    range: defaultRange(startup.timeMode),
    indicator: startup.indicator,
    timeIndex: 0,
    playing: false,
    speed: startup.speed,
    followLive: startup.timeMode === "realtime",
    selectedStationId: appConfig.stations[0].id,
    theme,
    basemap: appConfig.basemaps[theme],
    layerVisibility: Object.fromEntries(registry.layers.map((l) => [l.id, startup.layers[l.id] ?? l.visibleByDefault])),
    airQuality: null,
    weather: null,
    bmkg: [],
    loading: false,
    error: null,
    lastUpdated: null,
    layerErrors: {},
    mapTool: null,
  });

  document.title = appConfig.title;
  const logo = document.querySelector("calcite-navigation-logo")!;
  logo.heading = appConfig.title;
  logo.description = appConfig.subtitle;

  store.on(
    ["theme"],
    (s) => {
      document.body.classList.toggle("calcite-mode-dark", s.theme === "dark");
      document.body.classList.toggle("calcite-mode-light", s.theme === "light");
    },
    true,
  );

  const sceneEl = document.getElementById("scene") as HTMLArcgisSceneElement;
  // "item:<id>" = a Web Scene / Web Map portal item used as basemap.
  const toBasemap = (id: string) => (id.startsWith("item:") ? new Basemap({ portalItem: { id: id.slice(5) } }) : id);
  sceneEl.basemap = toBasemap(store.state.basemap);
  sceneEl.ground = "world-elevation";
  // Explicit spatial reference: the view still becomes ready if the basemap is unreachable.
  sceneEl.spatialReference = SpatialReference.WebMercator;
  const { longitude, latitude, z, heading, tilt } = appConfig.camera;
  sceneEl.camera = new Camera({ position: { longitude, latitude, z }, heading, tilt });
  await sceneEl.viewOnReady();

  const view = sceneEl.view;
  const map = view.map!;
  store.on(["basemap"], (s) => (map.basemap = toBasemap(s.basemap) as never));
  // Follow the theme only while the user is on one of the theme defaults.
  store.on(["theme"], (s) => {
    const defaults = [...Object.values(appConfig.basemaps), ...Object.values(appConfig.fallbackBasemaps)];
    if (!defaults.includes(s.basemap)) return;
    const fallback = Object.values(appConfig.fallbackBasemaps).includes(s.basemap);
    store.set({ basemap: (fallback ? appConfig.fallbackBasemaps : appConfig.basemaps)[s.theme] });
  });

  // 3D/2D views and the kawasan web map (SCBDPIK layer) on top of the shared 3D scene.
  const views = createViews();
  const data = new DataService(appConfig, store, registry);
  const ctx: AppContext = { config: appConfig, store, data, view, map, views };
  if (import.meta.env.DEV) {
    const [{ windStore }, { greeningStore }] = await Promise.all([import("./wind/state"), import("./greening/state")]);
    Object.assign(window, { __twin: { ...ctx, windStore, greeningStore } });
  }
  store.on(["mapTool"], (s) => sceneEl.classList.toggle("tool-active", !!s.mapTool));

  for (const layer of registry.layers) {
    try {
      await layer.init(ctx);
    } catch (err) {
      console.error(`Layer "${layer.id}" failed to initialise`, err);
    }
  }
  store.on(["layerVisibility"], (s) => registry.layers.forEach((l) => l.setVisible(s.layerVisibility[l.id] ?? l.visibleByDefault)), true);

  // Widgets shown and the panel opened on start (config.json "widgets").
  let widgets = startup.widgets ? registry.widgets.filter((w) => startup.widgets!.includes(w.id)) : registry.widgets;
  if (startup.openWidget !== null) widgets = widgets.map((w) => ({ ...w, openByDefault: w.id === startup.openWidget }));
  if (!startup.timelineDock) document.getElementById("dock")!.hidden = true;

  const header = document.getElementById("header-controls")!;
  mountKawasanHeader(views, header, authEnabled);
  mountHeader(ctx, header);
  mountWidgets(ctx, widgets, document.getElementById("panel-start")!, document.getElementById("panel-end")!);
  if (startup.viewMode === "2d") views.setMode("2d");
  if (configProblem) {
    // Own notice, so the web map sign-in notice does not hide it; click to dismiss.
    const notice = document.getElementById("config-notice")!;
    notice.textContent = `${configProblem} (klik untuk menutup)`;
    notice.hidden = false;
    notice.addEventListener("click", () => (notice.hidden = true), { once: true });
  }
  mountTimelineDock(ctx, document.getElementById("dock")!);
  startTimelinePlayer(store);

  document.getElementById("boot")?.remove();
  await data.load();
}

/**
 * Kawasan controls in the header: 3D/2D toggle (3D default), SCBD/PIK shortcuts and the ArcGIS
 * sign-in that loads the (private) web map "Analisis Kawasan PIK dan SCBD".
 */
function mountKawasanHeader(views: Views, host: HTMLElement, authEnabled: boolean): void {
  const toggle = document.createElement("calcite-segmented-control");
  toggle.scale = "s";
  toggle.setAttribute("aria-label", "Mode tampilan");
  for (const m of ["3d", "2d"] as Mode[]) {
    const item = document.createElement("calcite-segmented-control-item");
    item.value = m;
    item.checked = m === views.mode;
    item.textContent = m.toUpperCase();
    toggle.append(item);
  }
  toggle.addEventListener("calciteSegmentedControlChange", () => views.setMode(toggle.value as Mode));
  views.onModeChange((m) => {
    for (const i of toggle.querySelectorAll("calcite-segmented-control-item")) i.checked = i.value === m;
  });

  const wrap = document.createElement("div");
  wrap.className = "header__controls";
  wrap.append(toggle);
  for (const a of areas) {
    const b = document.createElement("calcite-button");
    b.scale = "s";
    b.appearance = "outline";
    b.iconStart = "bookmark";
    b.textContent = a.name;
    b.addEventListener("click", () => void views.goToArea(a));
    wrap.append(b);
  }

  // Web map: try without a prompt (works for public items / an existing OAuth session),
  // otherwise offer an explicit "Masuk ArcGIS" button.
  const notice = document.getElementById("notice")!;
  const signInBtn = document.createElement("calcite-button");
  signInBtn.scale = "s";
  signInBtn.iconStart = "user";
  signInBtn.hidden = true;
  signInBtn.textContent = "Masuk ArcGIS";
  wrap.append(signInBtn);
  host.append(wrap);

  const refresh = async () => {
    await views.loadWebmap();
    if (!views.webmapError) {
      notice.hidden = true;
      signInBtn.hidden = true;
      return;
    }
    notice.hidden = false;
    notice.textContent = authEnabled
      ? `Web map "Analisis Kawasan PIK dan SCBD" bersifat privat (${views.webmapError}). Klik "Masuk ArcGIS" untuk memuatnya.`
      : `Web map "Analisis Kawasan PIK dan SCBD" belum bisa dimuat (${views.webmapError}). Isi ARCGIS_CLIENT_ID di .env untuk login OAuth, atau bagikan item ke publik.`;
    signInBtn.hidden = !authEnabled;
  };
  signInBtn.addEventListener("click", async () => {
    signInBtn.loading = true;
    try {
      await signIn();
      await refresh();
    } catch (err) {
      notice.hidden = false;
      notice.textContent = `Gagal masuk: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      signInBtn.loading = false;
    }
  });
  void (async () => {
    if (authEnabled && (await isSignedIn())) await signIn().catch(() => undefined);
    await refresh();
  })();
}

bootstrap().catch((err) => {
  console.error(err);
  const boot = document.getElementById("boot-msg");
  if (boot) boot.textContent = `Gagal memuat aplikasi: ${err instanceof Error ? err.message : String(err)}`;
});
