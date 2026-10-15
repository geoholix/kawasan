import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import PointSymbol3D from "@arcgis/core/symbols/PointSymbol3D";
import type { LayerModule } from "../core/modules";
import { greeningStore, loadSpecies, type TreePlanting, type TreeSpecies } from "./state";

/** Max tree graphics drawn; bulk plantings beyond this are represented by a sample. */
const MAX_DISPLAY = 4000;

/** Random positions inside a circle (metres) around lon/lat. */
export function scatter(lon: number, lat: number, n: number, radiusM: number, accept?: (lon: number, lat: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.cos((lat * Math.PI) / 180);
  let guard = n * 20;
  while (out.length < n && guard-- > 0) {
    const r = radiusM * Math.sqrt(Math.random());
    const a = Math.random() * 2 * Math.PI;
    const p: [number, number] = [lon + (r * Math.cos(a)) / mPerDegLon, lat + (r * Math.sin(a)) / mPerDegLat];
    if (!accept || accept(p[0], p[1])) out.push(p);
  }
  return out;
}

/** Planted trees as simple 3D trees (trunk + crown), sized per species. */
export function createTreesLayer(speciesUrl: string): LayerModule {
  const layer = new GraphicsLayer({ title: "Pohon (simulasi)", elevationInfo: { mode: "on-the-ground" } });
  const symbols = new Map<string, PointSymbol3D>();

  const symbolFor = (sp: TreeSpecies) => {
    let s = symbols.get(sp.id);
    if (!s) {
      const trunkH = sp.heightM * 0.35;
      const crownH = sp.heightM - trunkH;
      s = new PointSymbol3D({
        symbolLayers: [
          { type: "object", resource: { primitive: "cylinder" }, width: Math.max(0.4, sp.crownM * 0.06), height: trunkH, anchor: "bottom", material: { color: [110, 78, 48] } },
          {
            type: "object",
            resource: { primitive: "sphere" },
            width: sp.crownM,
            depth: sp.crownM,
            height: crownH,
            anchor: "relative",
            // Lift the crown so its base sits on top of the trunk.
            anchorPosition: { x: 0, y: 0, z: -0.5 - trunkH / crownH },
            material: { color: [46, 139, 64, 0.95] },
          },
        ],
      });
      symbols.set(sp.id, s);
    }
    return s;
  };

  return {
    id: "trees",
    title: "Pohon (simulasi)",
    description: "Pohon hasil simulasi penanaman; menyerap CO₂ dan menjadi penghalang angin berpori.",
    visibleByDefault: false,

    init({ map, view, store }) {
      map.add(layer);
      void loadSpecies(speciesUrl);

      const render = () => {
        const { plantings, species } = greeningStore.state;
        layer.removeAll();
        const total = plantings.reduce((n, p) => n + p.positions.length, 0);
        const keep = total > MAX_DISPLAY ? MAX_DISPLAY / total : 1;
        const graphics: Graphic[] = [];
        for (const p of plantings) {
          const sp = species.find((x) => x.id === p.speciesId);
          if (!sp) continue;
          const sym = symbolFor(sp);
          for (const [lon, lat] of p.positions) {
            if (keep < 1 && Math.random() > keep) continue;
            graphics.push(new Graphic({ geometry: new Point({ longitude: lon, latitude: lat }), symbol: sym, attributes: { planting: p.id } }));
          }
        }
        layer.addMany(graphics);
      };
      greeningStore.on(["plantings", "species"], render, true);

      view.on("click", (event) => {
        if (store.state.mapTool !== "plant-trees" || !event.mapPoint) return;
        event.stopPropagation();
        const { selectedSpecies, clusterSize, clusterRadius, plantings, species } = greeningStore.state;
        const lon = event.mapPoint.longitude!;
        const lat = event.mapPoint.latitude!;
        const sp = species.find((x) => x.id === selectedSpecies);
        const planting: TreePlanting = {
          id: `p${Date.now().toString(36)}`,
          speciesId: selectedSpecies,
          positions: scatter(lon, lat, clusterSize, clusterRadius),
          count: clusterSize,
          label: `${clusterSize} ${sp?.name ?? selectedSpecies} @ ${lat.toFixed(4)}, ${lon.toFixed(4)}`,
        };
        greeningStore.set({ plantings: [...plantings, planting] });
      });
    },

    setVisible(visible) {
      layer.visible = visible;
    },
  };
}
