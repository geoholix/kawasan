import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import PointSymbol3D from "@arcgis/core/symbols/PointSymbol3D";
import type { LayerModule } from "../core/modules";
import { hourlyRate, SECTOR_COLORS, SECTORS } from "./model";
import { emissionStore, loadInventory } from "./state";

const METRES_PER_TONNE_HOUR = 0.25; // vertical scale: 1 tCO₂e/hour = 0.25 m (a city zone stacks to roughly 200 m)
const WIDTH = 120;
const GAP = 1; // surface-coloured gap between stacked segments

/**
 * Stacked 3D columns per kota administrasi: one segment per sector, height =
 * estimated emission rate at the timeline's current hour (incl. scenario).
 */
export function createEmissionsLayer(inventoryUrl: string): LayerModule {
  const layer = new GraphicsLayer({ title: "Emisi CO₂e", elevationInfo: { mode: "relative-to-ground" }, visible: false });

  return {
    id: "emissions",
    title: "Emisi CO₂e (estimasi)",
    description: "Kolom bertumpuk per kota administrasi; tinggi = laju emisi per jam menurut sektor (termasuk skenario).",
    visibleByDefault: false,
    legend: SECTORS.map((s) => ({ label: s.label, color: SECTOR_COLORS.dark[s.id] })),

    init({ store, map }) {
      map.add(layer);
      void loadInventory(inventoryUrl);

      const render = () => {
        const { inventory, result } = emissionStore.state;
        const s = store.state;
        layer.removeAll();
        if (!inventory || !result) return;
        const t = s.airQuality?.times[s.timeIndex] ?? Date.now();
        const colors = SECTOR_COLORS[s.theme];
        const graphics: Graphic[] = [];
        for (const zone of inventory.zones) {
          const rate = hourlyRate(result.zones[zone.id], t);
          let z = 0;
          for (const sector of SECTORS) {
            const h = rate[sector.id] * METRES_PER_TONNE_HOUR;
            if (h < 1) continue;
            graphics.push(
              new Graphic({
                geometry: new Point({ longitude: zone.longitude, latitude: zone.latitude, z }),
                symbol: new PointSymbol3D({
                  symbolLayers: [
                    {
                      type: "object",
                      resource: { primitive: "cylinder" },
                      width: WIDTH,
                      height: Math.max(1, h - GAP),
                      anchor: "bottom",
                      material: { color: colors[sector.id] },
                    },
                  ],
                }),
                attributes: { zone: zone.name, sector: sector.label, rate: Math.round(rate[sector.id]) },
                popupTemplate: { title: "{zone}", content: "{sector}: <b>{rate}</b> t CO₂e/jam (estimasi)" },
              }),
            );
            z += h;
          }
        }
        layer.addMany(graphics);
      };

      store.on(["timeIndex", "airQuality", "theme"], render, true);
      emissionStore.on(["result"], render);
    },

    setVisible(visible) {
      layer.visible = visible;
    },
  };
}
