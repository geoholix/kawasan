import Graphic from "@arcgis/core/Graphic";
import Polygon from "@arcgis/core/geometry/Polygon";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import PolygonSymbol3D from "@arcgis/core/symbols/PolygonSymbol3D";
import { idw, loadBoundaryRing, pointInRing, type WeightedPoint } from "../core/geo";
import { categoryOf, subIndex } from "../core/ispu";
import type { LayerModule } from "../core/modules";
import { readingsAt } from "../core/selectors";

/**
 * Interpolated pollution "volume": a grid of translucent extruded cells over
 * DKI Jakarta. Each cell's value is the IDW interpolation of the stations,
 * coloured by ISPU category and extruded by its index.
 */
export function createPollutionSurfaceLayer(): LayerModule {
  const layer = new GraphicsLayer({ title: "Indeks permukaan polusi (interpolasi)", elevationInfo: { mode: "on-the-ground" } });
  const cache = new Map<string, PolygonSymbol3D>();
  let opacity = 0.3;
  let render: () => void = () => {};

  const symbol = (color: string | null, height: number) => {
    const h = Math.max(10, Math.round(height / 15) * 15);
    const key = `${color}|${h}|${opacity}`;
    let s = cache.get(key);
    if (!s) {
      s = new PolygonSymbol3D({
        symbolLayers: color
          ? [{ type: "extrude", size: h, material: { color: hexToRgba(color, opacity) }, castShadows: false }]
          : [],
      });
      cache.set(key, s);
    }
    return s;
  };

  return {
    id: "surface",
    title: "Indeks permukaan polusi",
    description: "Interpolasi IDW antar stasiun; tinggi volume = indeks (bukan ketebalan lapisan polusi).",
    visibleByDefault: true,
    controls: [
      {
        type: "slider",
        label: "Opasitas volume",
        min: 0.1,
        max: 0.9,
        step: 0.05,
        value: opacity,
        onChange(value) {
          opacity = value;
          cache.clear();
          render();
        },
      },
    ],

    async init({ config, map, store }) {
      map.add(layer);
      const ring = await loadBoundaryRing(config.boundaryUrl);
      const [xmin, ymin, xmax, ymax] = config.extent;
      const step = config.gridCellSize;
      const cells: { x: number; y: number; graphic: Graphic }[] = [];

      for (let x = xmin; x < xmax; x += step) {
        for (let y = ymin; y < ymax; y += step) {
          const cx = x + step / 2;
          const cy = y + step / 2;
          if (ring && !pointInRing(cx, cy, ring)) continue;
          const pad = step * 0.04; // thin gap between cells keeps the grid readable
          const graphic = new Graphic({
            geometry: new Polygon({
              rings: [[[x + pad, y + pad], [x + pad, y + step - pad], [x + step - pad, y + step - pad], [x + step - pad, y + pad], [x + pad, y + pad]]],
              spatialReference: { wkid: 4326 },
            }),
          });
          cells.push({ x: cx, y: cy, graphic });
        }
      }
      layer.addMany(cells.map((c) => c.graphic));

      render = () => {
        const s = store.state;
        const byId = new Map(config.stations.map((st) => [st.id, st]));
        const points: WeightedPoint[] = readingsAt(s).flatMap((r) => {
          const st = byId.get(r.stationId);
          return st && r.value != null ? [{ x: st.longitude, y: st.latitude, value: r.value }] : [];
        });
        for (const cell of cells) {
          const value = points.length ? idw(cell.x, cell.y, points) : null;
          const index = value == null ? null : s.indicator === "ispu" ? value : subIndex(s.indicator, value);
          const cat = categoryOf(index);
          // ~1.5 m per index point keeps the volume below most high-rise roofs.
          const next = symbol(cat?.color ?? null, (index ?? 0) * 1.5);
          if (cell.graphic.symbol !== next) cell.graphic.symbol = next;
        }
      };

      store.on(["airQuality", "timeIndex", "indicator"], render, true);
    },

    setVisible(visible) {
      layer.visible = visible;
    },
  };
}

function hexToRgba(hex: string, alpha: number): number[] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}
