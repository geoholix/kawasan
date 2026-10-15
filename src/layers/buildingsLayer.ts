import GeoJSONLayer from "@arcgis/core/layers/GeoJSONLayer";
import Layer from "@arcgis/core/layers/Layer";
import SceneLayer from "@arcgis/core/layers/SceneLayer";
import PortalItem from "@arcgis/core/portal/PortalItem";
import SimpleRenderer from "@arcgis/core/renderers/SimpleRenderer";
import SolidEdges3D from "@arcgis/core/symbols/edges/SolidEdges3D";
import type { BuildingSource } from "../config/app.config";
import type { AppContext, LayerModule } from "../core/modules";

type StandaloneSource = Exclude<BuildingSource, { type: "basemap" }>;

const meshRenderer = (theme: "dark" | "light") =>
  new SimpleRenderer({
    symbol: {
      type: "mesh-3d",
      symbolLayers: [
        {
          type: "fill",
          material: { color: theme === "dark" ? [150, 160, 175, 1] : [235, 237, 240, 1], colorMixMode: "replace" },
          edges: new SolidEdges3D({ color: theme === "dark" ? [20, 24, 32, 0.5] : [80, 80, 80, 0.35], size: 0.6 }),
        },
      ],
    },
  });

const BASEMAP_ITEM_TYPES = ["Web Scene", "Web Map"];
const BUILDING_TITLE = /build|bangunan|gedung/i;
const isRemoteBasemap = (id: string) => id.endsWith("-3d") || id.startsWith("item:");

type Resolved = { kind: "layer"; layer: Layer } | { kind: "basemap"; itemId: string };

/** Turn a building source into a layer, or tell the caller the item is a basemap (Web Scene / Web Map). */
async function resolveSource(src: StandaloneSource, { store }: AppContext): Promise<Resolved> {
  if (src.type === "geojson") {
    const layer = new GeoJSONLayer({
      url: src.url,
      title: "Bangunan 3D",
      renderer: new SimpleRenderer({
        symbol: { type: "polygon-3d", symbolLayers: [{ type: "extrude", material: { color: [190, 196, 205, 1] } }] },
        visualVariables: [
          {
            type: "size",
            valueExpression: `DefaultValue($feature["${src.heightField}"], ${src.defaultHeight ?? 9})`,
            valueUnit: "meters",
          },
        ],
      }),
    });
    await layer.load();
    return { kind: "layer", layer };
  }

  let layer: Layer;
  if (src.type === "scene-service") {
    layer = new SceneLayer({ url: src.url });
  } else {
    const item = new PortalItem({ id: src.id, ...(src.portalUrl ? { portal: { url: src.portalUrl } } : {}) });
    await item.load();
    if (BASEMAP_ITEM_TYPES.includes(item.type ?? "")) return { kind: "basemap", itemId: src.id };
    layer = await Layer.fromPortalItem({ portalItem: item });
  }
  await layer.load();
  layer.title = layer.title || "Bangunan 3D";
  if (layer instanceof SceneLayer) {
    layer.popupEnabled = false;
    // Only restyle plain building meshes; keep textured models as published.
    if (layer.geometryType === "mesh" && !layer.renderer) {
      store.on(["theme"], (s) => ((layer as SceneLayer).renderer = meshRenderer(s.theme)), true);
    }
  }
  return { kind: "layer", layer };
}

/**
 * 3D city model.
 * - `buildings.type = "basemap"`: use the buildings of the active ArcGIS 3D basemap.
 * - `portal-item`: a layer item is added as the building layer (basemap buildings are hidden to
 *   avoid duplicates); a Web Scene / Web Map item becomes the basemap.
 * When the primary source fails, or a 2D basemap is active, `buildingsFallback` is shown.
 */
export function createBuildingsLayer(): LayerModule {
  let visible = true;
  let mode: "basemap" | "standalone" = "basemap";
  let primary: Layer | null = null;
  let fallback: Layer | null = null;
  let basemapBuildings: Layer[] = [];

  const applyVisibility = () => {
    basemapBuildings.forEach((l) => (l.visible = visible && mode === "basemap"));
    if (primary) primary.visible = visible && mode === "standalone";
    if (fallback) fallback.visible = visible && mode === "basemap" && basemapBuildings.length === 0;
  };

  return {
    id: "buildings",
    title: "Bangunan 3D",
    description: "Sumber utama dari appConfig.buildings (item ArcGIS / basemap 3D); cadangan OSM 3D Buildings.",
    visibleByDefault: true,

    init(ctx) {
      const { config, map, store } = ctx;
      visible = store.state.layerVisibility.buildings ?? true;
      const src = config.buildings;
      const fallbackSource = config.buildingsFallback ?? (src.type === "basemap" ? src.fallback : undefined);

      const reportError = (message: string) =>
        store.set({ layerErrors: { ...store.state.layerErrors, buildings: message } });

      let fallbackRequested = false;
      const ensureFallback = () => {
        if (fallbackRequested || !fallbackSource) return;
        fallbackRequested = true;
        resolveSource(fallbackSource, ctx)
          .then((r) => {
            if (r.kind === "basemap") return store.set({ basemap: `item:${r.itemId}` });
            fallback = r.layer;
            map.add(fallback, 0);
            applyVisibility();
          })
          .catch((err) => {
            console.warn("Fallback building layer failed to load", err);
            reportError("Bangunan 3D gagal dimuat. Periksa koneksi ke ArcGIS Online (arcgis.com) atau sumber bangunan di appConfig.buildings.");
          });
      };

      // Find the buildings inside the active basemap whenever it changes.
      let token = 0;
      const syncBasemap = async () => {
        const run = ++token;
        const id = store.state.basemap;
        let found: Layer[] = [];
        try {
          const basemap = map.basemap;
          if (basemap) {
            await basemap.load();
            found = [...basemap.baseLayers.toArray(), ...basemap.referenceLayers.toArray()].filter(
              (l) => /-buildings$/.test(l.id) || BUILDING_TITLE.test(l.title ?? ""),
            );
            await Promise.all(found.map((l) => l.load()));
          }
        } catch (err) {
          if (run !== token) return;
          console.warn("Basemap failed to load", err);
          if (isRemoteBasemap(id)) {
            reportError("Basemap 3D tidak dapat dimuat (mungkin perlu login / API key ArcGIS, lihat VITE_ARCGIS_API_KEY). Beralih ke basemap 2D + bangunan cadangan.");
            store.set({ basemap: config.fallbackBasemaps[store.state.theme] });
            return;
          }
        }
        if (run !== token) return;
        basemapBuildings = found;
        if (mode === "basemap" && !found.length) ensureFallback();
        applyVisibility();
      };
      store.on(["basemap"], () => void syncBasemap(), true);

      if (src.type === "basemap") return;

      mode = "standalone";
      resolveSource(src, ctx)
        .then((r) => {
          if (r.kind === "basemap") {
            mode = "basemap";
            store.set({ basemap: `item:${r.itemId}` });
            return;
          }
          primary = r.layer;
          map.add(primary, 0);
          applyVisibility();
        })
        .catch((err) => {
          console.warn("Primary building source failed to load", err);
          reportError("Sumber bangunan utama gagal dimuat; memakai bangunan dari basemap 3D / cadangan.");
          mode = "basemap";
          if (!basemapBuildings.length) ensureFallback();
          applyVisibility();
        });
    },

    setVisible(value) {
      visible = value;
      applyVisibility();
    },
  };
}
