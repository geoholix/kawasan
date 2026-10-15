import Graphic from "@arcgis/core/Graphic";
import Polyline from "@arcgis/core/geometry/Polyline";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import LineSymbol3D from "@arcgis/core/symbols/LineSymbol3D";
import { idw, loadBoundaryRing, pointInRing } from "../core/geo";
import type { LayerModule } from "../core/modules";
import { weatherAt } from "../core/selectors";

const SPEED_CLASSES = [
  { max: 2, label: "< 2 m/s (tenang)", width: 1.5 },
  { max: 5, label: "2–5 m/s", width: 2.5 },
  { max: Infinity, label: "> 5 m/s", width: 3.5 },
];

/**
 * Wind field: arrows on a coarse grid pointing where the wind blows TO,
 * interpolated (u/v components) from the weather locations. Arrow length
 * and width grow with wind speed.
 */
export function createWindLayer(): LayerModule {
  const layer = new GraphicsLayer({ title: "Angin", elevationInfo: { mode: "relative-to-ground", offset: 450 } });
  const symbols = new Map<string, LineSymbol3D>();

  const symbol = (width: number, theme: "dark" | "light") => {
    const key = `${width}|${theme}`;
    let s = symbols.get(key);
    if (!s) {
      const color = theme === "dark" ? [210, 236, 255, 0.95] : [20, 60, 110, 0.9];
      s = new LineSymbol3D({
        symbolLayers: [{ type: "line", size: width, material: { color }, cap: "round", marker: { type: "style", style: "arrow", placement: "end", color } }],
      });
      symbols.set(key, s);
    }
    return s;
  };

  return {
    id: "wind",
    title: "Panah angin",
    description: "Arah & kecepatan angin sebagai panah statis (interpolasi dari titik cuaca).",
    visibleByDefault: false,
    legend: SPEED_CLASSES.map((c) => ({ label: c.label, icon: "arrow-up" })),

    async init({ config, map, store }) {
      map.add(layer);
      const ring = await loadBoundaryRing(config.boundaryUrl);
      const [xmin, ymin, xmax, ymax] = config.extent;
      const step = config.gridCellSize * 2.5;
      const anchors: { x: number; y: number }[] = [];
      for (let x = xmin + step / 2; x < xmax; x += step) {
        for (let y = ymin + step / 2; y < ymax; y += step) {
          if (!ring || pointInRing(x, y, ring)) anchors.push({ x, y });
        }
      }

      const render = () => {
        const s = store.state;
        const samples = weatherAt(s);
        const u: { x: number; y: number; value: number }[] = [];
        const v: typeof u = [];
        for (const loc of config.weatherLocations) {
          const w = samples[loc.id];
          if (w?.windSpeed == null || w.windDirection == null) continue;
          // Direction the wind blows TOWARDS, as a vector.
          const to = ((w.windDirection + 180) * Math.PI) / 180;
          u.push({ x: loc.longitude, y: loc.latitude, value: Math.sin(to) * w.windSpeed });
          v.push({ x: loc.longitude, y: loc.latitude, value: Math.cos(to) * w.windSpeed });
        }
        layer.removeAll();
        if (!u.length) return;
        const graphics: Graphic[] = [];
        for (const a of anchors) {
          const du = idw(a.x, a.y, u) ?? 0;
          const dv = idw(a.x, a.y, v) ?? 0;
          const speed = Math.hypot(du, dv);
          if (speed < 0.05) continue;
          // Arrow length in degrees: ~ (300 m + 220 m per m/s), capped to the grid spacing.
          const len = Math.min(step * 0.85, (300 + speed * 220) / 111_000);
          const dx = (du / speed) * len;
          const dy = (dv / speed) * len;
          const cls = SPEED_CLASSES.find((c) => speed < c.max)!;
          graphics.push(
            new Graphic({
              geometry: new Polyline({
                paths: [[[a.x - dx / 2, a.y - dy / 2], [a.x + dx / 2, a.y + dy / 2]]],
                spatialReference: { wkid: 4326 },
              }),
              symbol: symbol(cls.width, s.theme),
            }),
          );
        }
        layer.addMany(graphics);
      };

      store.on(["weather", "timeIndex", "theme"], render, true);
    },

    setVisible(visible) {
      layer.visible = visible;
    },
  };
}
