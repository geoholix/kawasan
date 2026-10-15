import { INDICATOR_LABELS, indicatorUnit, thresholdsFor } from "../core/ispu";
import type { WidgetModule } from "../core/modules";
import { indicatorSeries } from "../core/selectors";
import { floorHour } from "../core/time";
import type { Indicator, WeatherSample } from "../core/types";
import { h } from "../ui/dom";
import { createLineChart } from "../ui/lineChart";

const WEATHER_METRICS: { id: keyof WeatherSample; label: string; unit: string }[] = [
  { id: "temperature", label: "Suhu", unit: "°C" },
  { id: "humidity", label: "Kelembapan", unit: "%" },
  { id: "windSpeed", label: "Kecepatan angin", unit: "m/s" },
  { id: "boundaryLayerHeight", label: "Tinggi lapisan batas (PBL)", unit: "m" },
  { id: "precipitation", label: "Curah hujan", unit: "mm" },
  { id: "cloudCover", label: "Tutupan awan", unit: "%" },
];

/** Time series of the active indicator for one station, plus one weather metric for the nearest weather point. */
export const chartWidget: WidgetModule = {
  id: "chart",
  title: "Grafik time series",
  icon: "graph-time-series",
  placement: "start",


  create({ store, config }) {
    const station = h("calcite-select", { label: "Stasiun", scale: "s" });
    for (const s of config.stations) station.append(h("calcite-option", { value: s.id }, s.name));
    station.addEventListener("calciteSelectChange", () => store.set({ selectedStationId: station.value }));

    const metric = h("calcite-select", { label: "Variabel cuaca", scale: "s" });
    for (const m of WEATHER_METRICS) metric.append(h("calcite-option", { value: m.id }, `${m.label} (${m.unit})`));

    const aqTitle = h("div", { class: "section-title" });
    const wxTitle = h("div", { class: "section-title" });
    const aqHost = h("div");
    const wxHost = h("div");
    const select = (i: number) => store.set({ timeIndex: i, followLive: false, playing: false });
    const aqChart = createLineChart(aqHost, select, 170);
    const wxChart = createLineChart(wxHost, select, 130);

    const nearestWeather = (stationId: string) => {
      const st = config.stations.find((s) => s.id === stationId);
      if (!st) return config.weatherLocations[0];
      return [...config.weatherLocations].sort(
        (a, b) => Math.hypot(a.latitude - st.latitude, a.longitude - st.longitude) - Math.hypot(b.latitude - st.latitude, b.longitude - st.longitude),
      )[0];
    };

    const render = () => {
      const s = store.state;
      const id = s.selectedStationId ?? config.stations[0].id;
      station.value = id;
      const times = s.airQuality?.times ?? [];
      const now = floorHour(Date.now());
      const ind: Indicator = s.indicator;
      const stationName = config.stations.find((x) => x.id === id)?.name ?? id;
      aqTitle.textContent = `${INDICATOR_LABELS[ind]} ${indicatorUnit(ind) ? `(${indicatorUnit(ind)}) ` : ""}— ${stationName}`;
      aqChart.update({
        times,
        values: indicatorSeries(s, id, ind),
        currentIndex: s.timeIndex,
        nowTime: now,
        unit: indicatorUnit(ind),
        label: `${INDICATOR_LABELS[ind]} ${stationName}`,
        thresholds: thresholdsFor(ind).map((t) => ({ value: t.value, label: `batas ${t.category.label}`, color: t.category.color })),
      });

      const m = WEATHER_METRICS.find((x) => x.id === metric.value) ?? WEATHER_METRICS[0];
      const loc = nearestWeather(id);
      const series = s.weather?.locations[loc.id] ?? [];
      wxTitle.textContent = `${m.label} (${m.unit}) — ${loc.name}`;
      wxChart.update({
        times: s.weather?.times ?? [],
        values: series.map((w) => (w ? (w[m.id] as number | null) : null)),
        currentIndex: s.timeIndex,
        nowTime: now,
        unit: m.unit,
        label: `${m.label} ${loc.name}`,
      });
    };

    metric.addEventListener("calciteSelectChange", render);
    store.on(["airQuality", "weather", "timeIndex", "indicator", "selectedStationId"], render, true);

    return h(
      "div",
      { class: "widget" },
      h("calcite-label", { scale: "s" }, "Stasiun", station),
      aqTitle,
      aqHost,
      h("calcite-label", { scale: "s" }, "Variabel cuaca", metric),
      wxTitle,
      wxHost,
      h("p", { class: "muted small" }, "Klik grafik untuk lompat ke jam tersebut. Area berarsir = prakiraan. ISPU dihitung dari nilai per jam (indikatif)."),
    );
  },
};
