import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import PointSymbol3D from "@arcgis/core/symbols/PointSymbol3D";
import type GraphicsLayerView from "@arcgis/core/views/layers/GraphicsLayerView";
import { categoryOf, INDICATOR_LABELS, indicatorUnit, ISPU_CATEGORIES } from "../core/ispu";
import type { LayerModule } from "../core/modules";
import { readingsAt } from "../core/selectors";

const NO_DATA = "#8a8f98";

/** Height of a station column (m) from its ISPU sub-index: 30-230 m, comparable to the surrounding buildings. */
function columnHeight(index: number | null): number {
  return 30 + Math.min(index ?? 0, 400) * 0.5;
}

/** Monitoring stations as 3D columns: height and colour follow the active indicator. */
export function createStationsLayer(): LayerModule {
  const columns = new GraphicsLayer({ title: "Stasiun pemantau", elevationInfo: { mode: "relative-to-ground" } });
  const labels = new GraphicsLayer({ title: "Label stasiun", elevationInfo: { mode: "relative-to-ground" } });
  const symbolCache = new Map<string, PointSymbol3D>();

  const columnSymbol = (color: string, height: number) => {
    const key = `${color}|${Math.round(height / 5)}`;
    let s = symbolCache.get(key);
    if (!s) {
      s = new PointSymbol3D({
        symbolLayers: [
          {
            type: "object",
            resource: { primitive: "cylinder" },
            width: 40,
            height: Math.round(height / 5) * 5,
            anchor: "bottom",
            material: { color },
          },
        ],
      });
      symbolCache.set(key, s);
    }
    return s;
  };

  const labelSymbol = (text: string, theme: "dark" | "light") =>
    new PointSymbol3D({
      symbolLayers: [
        {
          type: "text",
          text,
          size: 10,
          material: { color: theme === "dark" ? "#f3f4f6" : "#111827" },
          halo: { color: theme === "dark" ? [0, 0, 0, 0.75] : [255, 255, 255, 0.9], size: 1.5 },
          font: { weight: "bold" },
        },
      ],
      verticalOffset: { screenLength: 14, maxWorldLength: 150 },
      callout: { type: "line", size: 0.5, color: theme === "dark" ? [255, 255, 255, 0.5] : [0, 0, 0, 0.4] },
    });

  return {
    id: "stations",
    title: "Stasiun pemantau",
    description: "Kolom 3D per stasiun; tinggi dan warna sesuai kategori ISPU.",
    visibleByDefault: true,
    legend: ISPU_CATEGORIES.map((c) => ({ label: `${c.label} (${c.min}–${c.max})`, color: c.color, icon: c.icon })),

    init({ config, map, store, view }) {
      map.addMany([columns, labels]);
      const graphics = new Map<string, Graphic>();
      const labelGraphics = new Map<string, Graphic>();
      let highlight: { remove(): void } | null = null;

      for (const station of config.stations) {
        const geometry = new Point({ longitude: station.longitude, latitude: station.latitude, z: 0 });
        const g = new Graphic({
          geometry,
          attributes: { stationId: station.id, name: station.name, kind: station.kind, district: station.district ?? "" },
          popupTemplate: {
            title: "{name}",
            content: "<b>{indicator}</b>: {valueText}<br/>ISPU indikatif: {ispuText} ({category})<br/>Polutan dominan: {dominant}<br/><small>{kindText} · {district}</small>",
          },
        });
        graphics.set(station.id, g);
        const label = new Graphic({ geometry: geometry.clone(), attributes: { stationId: station.id } });
        labelGraphics.set(station.id, label);
      }
      columns.addMany([...graphics.values()]);
      labels.addMany([...labelGraphics.values()]);

      const kindText = { spku: "SPKU", embassy: "US Embassy", model: "Titik model" };

      const render = () => {
        const s = store.state;
        const readings = new Map(readingsAt(s).map((r) => [r.stationId, r]));
        for (const station of config.stations) {
          const r = readings.get(station.id);
          const cat = categoryOf(r?.index);
          const height = columnHeight(r?.index ?? null);
          const g = graphics.get(station.id)!;
          g.symbol = columnSymbol(cat?.color ?? NO_DATA, height);
          const unit = indicatorUnit(s.indicator);
          const valueText = r?.value != null ? `${Math.round(r.value)}${unit ? ` ${unit}` : ""}` : "tidak ada data";
          g.attributes = {
            ...g.attributes,
            indicator: INDICATOR_LABELS[s.indicator],
            valueText,
            ispuText: r?.ispu ?? "–",
            category: categoryOf(r?.ispu)?.label ?? "–",
            dominant: r?.dominant ? INDICATOR_LABELS[r.dominant] : "–",
            kindText: kindText[station.kind],
          };
          const label = labelGraphics.get(station.id)!;
          (label.geometry as Point).z = Math.round(height / 5) * 5;
          label.geometry = label.geometry!.clone();
          label.symbol = labelSymbol(r?.value != null ? `${station.shortName} · ${Math.round(r.value)}` : station.shortName, s.theme);
        }
      };

      store.on(["airQuality", "timeIndex", "indicator", "theme"], render, true);

      void view.whenLayerView(columns).then((lv: GraphicsLayerView) => {
        store.on(
          ["selectedStationId"],
          (s) => {
            highlight?.remove();
            const g = s.selectedStationId ? graphics.get(s.selectedStationId) : null;
            highlight = g ? lv.highlight(g) : null;
          },
          true,
        );
      });

      view.on("click", async (event) => {
        if (store.state.mapTool) return; // another tool owns map clicks
        const hit = await view.hitTest(event, { include: [columns, labels] });
        const graphicHit = hit.results.find((r) => r.type === "graphic");
        const id = graphicHit && "graphic" in graphicHit ? graphicHit.graphic.attributes?.stationId : null;
        if (id) store.set({ selectedStationId: id });
      });
    },

    setVisible(visible) {
      columns.visible = visible;
      labels.visible = visible;
    },
  };
}
