import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import PointSymbol3D from "@arcgis/core/symbols/PointSymbol3D";
import { categoryOf, subIndex } from "../core/ispu";
import type { LayerModule } from "../core/modules";
import { average, indicatorSeries } from "../core/selectors";
import type { AppState } from "../core/store";
import { formatShortDate, formatTime } from "../core/time";
import { autoBinHours, binTimes } from "../core/trend";

const SLICE_HEIGHT = 5; // metres per time bin (<= 40 bins, so the stack stays under ~200 m like the surrounding buildings)
const BASE = 15; // small lift above ground
const SIZE = 50; // metres

/**
 * Space-time cube: each station becomes a vertical stack of voxels. Height =
 * time (oldest at the bottom), colour = ISPU category of the bin's mean.
 * The slice containing the timeline's current hour is drawn opaque, so the
 * playhead travels up the cube during playback.
 */
export function createSpaceTimeCubeLayer(): LayerModule {
  const layer = new GraphicsLayer({ title: "Space-time cube", elevationInfo: { mode: "relative-to-ground" }, visible: false });
  const cache = new Map<string, PointSymbol3D>();

  const voxel = (color: string, alpha: number) => {
    const key = `${color}|${alpha}`;
    let s = cache.get(key);
    if (!s) {
      const n = parseInt(color.slice(1), 16);
      s = new PointSymbol3D({
        symbolLayers: [
          {
            type: "object",
            resource: { primitive: "cube" },
            width: SIZE,
            depth: SIZE,
            height: SLICE_HEIGHT * 0.88,
            anchor: "bottom",
            material: { color: [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha] },
          },
        ],
      });
      cache.set(key, s);
    }
    return s;
  };

  const label = (text: string, theme: AppState["theme"]) =>
    new PointSymbol3D({
      symbolLayers: [
        {
          type: "text",
          text,
          size: 9,
          material: { color: theme === "dark" ? "#e5e7eb" : "#1f2937" },
          halo: { color: theme === "dark" ? [0, 0, 0, 0.7] : [255, 255, 255, 0.85], size: 1 },
        },
      ],
    });

  return {
    id: "space-time-cube",
    title: "Space-time cube",
    description: "Tumpukan voxel per stasiun: sumbu vertikal = waktu (lama → baru ke atas), warna = kategori ISPU. Irisan terang = jam aktif.",
    visibleByDefault: false,

    init({ config, map, store }) {
      map.add(layer);
      let lastKey = "";
      let voxels: { graphic: Graphic; bin: number; color: string }[] = [];

      const build = (s: AppState) => {
        layer.removeAll();
        voxels = [];
        const times = s.airQuality?.times ?? [];
        if (!times.length) return;
        const bins = binTimes(times, autoBinHours(times.length));
        const graphics: Graphic[] = [];

        for (const st of config.stations) {
          const series = indicatorSeries(s, st.id);
          bins.forEach((bin, b) => {
            const mean = average(bin.indices.map((i) => series[i] ?? null));
            if (mean == null) return;
            const index = s.indicator === "ispu" ? mean : subIndex(s.indicator, mean);
            const color = categoryOf(index)?.color ?? "#8a8f98";
            const graphic = new Graphic({
              geometry: new Point({ longitude: st.longitude, latitude: st.latitude, z: BASE + b * SLICE_HEIGHT }),
              attributes: { stationId: st.id, name: st.name, bin: b, mean: Math.round(mean), from: bin.start },
              popupTemplate: { title: "{name}", content: `Rata-rata irisan: <b>{mean}</b><br/>Mulai: ${formatShortDate(bin.start)} ${formatTime(bin.start)} WIB` },
            });
            voxels.push({ graphic, bin: b, color });
            graphics.push(graphic);
          });
        }

        // Time ruler at the south-east corner of the area, away from station labels.
        const [, ymin, xmax, ymax] = config.extent;
        const anchor = { longitude: xmax - 0.01, latitude: ymin + (ymax - ymin) * 0.12 };
        const every = Math.max(1, Math.ceil(bins.length / 8));
        bins.forEach((bin, b) => {
          if (b % every && b !== bins.length - 1) return;
          graphics.push(
            new Graphic({
              geometry: new Point({ longitude: anchor.longitude, latitude: anchor.latitude, z: BASE + b * SLICE_HEIGHT + SLICE_HEIGHT / 2 }),
              symbol: label(`${formatShortDate(bin.start)} ${formatTime(bin.start)}`, s.theme),
            }),
          );
        });
        layer.addMany(graphics);
        highlight(s);
      };

      const highlight = (s: AppState) => {
        const times = s.airQuality?.times ?? [];
        const hours = autoBinHours(times.length);
        const current = times.length ? Math.floor((times[s.timeIndex] - times[0]) / (hours * 3_600_000)) : -1;
        for (const v of voxels) {
          const alpha = v.bin === current ? 1 : v.bin < current ? 0.55 : 0.25;
          const sym = voxel(v.color, alpha);
          if (v.graphic.symbol !== sym) v.graphic.symbol = sym;
        }
      };

      store.on(["airQuality", "indicator", "theme", "timeIndex"], (s) => {
        const key = `${s.airQuality?.times[0]}|${s.airQuality?.times.length}|${s.indicator}|${s.theme}|${s.lastUpdated}`;
        if (key !== lastKey) {
          lastKey = key;
          build(s);
        } else highlight(s);
      }, true);
    },

    setVisible(visible) {
      layer.visible = visible;
    },
  };
}
