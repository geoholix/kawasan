import type { WidgetModule } from "../core/modules";
import { cityWeather } from "../core/selectors";
import { floorHour, formatDateTime } from "../core/time";
import { slotAt } from "../providers/weather/bmkg";
import { compassLabel } from "../providers/weather/conditions";
import { h } from "../ui/dom";
import { createLineChart } from "../ui/lineChart";
import { DISTURBANCE_STOPS, windStore } from "./state";
import { LEVELS, profileFactor } from "./wind3d";

const gradient = `linear-gradient(to top, ${[...DISTURBANCE_STOPS].reverse().map((s, i, a) => `${s.color} ${(i / (a.length - 1)) * 100}%`).join(", ")})`;

/** Floating legend over the scene, shown while the wind simulation is visible. */
function mountMapLegend(visible: () => boolean, subscribe: (fn: () => void) => void) {
  const stage = document.querySelector(".stage");
  if (!stage) return;
  const el = h(
    "div",
    { class: "wind-legend" },
    h("div", { class: "wind-legend__title" }, "Gangguan aliran angin"),
    h(
      "div",
      { class: "wind-legend__body" },
      h("div", { class: "wind-legend__bar", style: `background:${gradient}` }),
      h("div", { class: "wind-legend__labels" }, h("span", {}, "Lemah"), h("span", {}, "↕"), h("span", {}, "Kuat")),
    ),
  );
  stage.append(el);
  subscribe(() => (el.hidden = !visible()));
}

/** Wind simulation: one switch for the whole simulation, probe, what-if buildings, particle settings. */
export const windWidget: WidgetModule = {
  id: "wind",
  title: "Simulasi angin 3D",
  icon: "wind",
  placement: "start",

  create({ store, config }) {
    mountMapLegend(
      () => store.state.layerVisibility["wind-flow"] ?? false,
      (fn) => store.on(["layerVisibility"], fn, true),
    );

    const source = h("div", { class: "hero__weather" });
    const toggle = (label: string, checked: boolean, onChange: (v: boolean) => void) => {
      const sw = h("calcite-switch", { checked, label });
      sw.addEventListener("calciteSwitchChange", () => onChange(sw.checked));
      return { sw, row: h("div", { class: "switch-row" }, sw, h("span", {}, label)) };
    };

    const sim = toggle("Tampilkan simulasi angin", false, (v) => store.set({ layerVisibility: { ...store.state.layerVisibility, "wind-flow": v } }));
    store.on(["layerVisibility"], (s) => (sim.sw.checked = s.layerVisibility["wind-flow"] ?? false), true);

    const level = h("calcite-select", { label: "Ketinggian partikel", scale: "s" });
    for (const l of LEVELS.slice(0, -1)) level.append(h("calcite-option", { value: String(l), selected: l === windStore.state.animLevel }, `${l} m${l === 2 ? " (pejalan kaki)" : ""}`));
    level.addEventListener("calciteSelectChange", () => windStore.set({ animLevel: Number(level.value) }));

    const stats = h("div", { class: "hero__meta" });

    // --- probe
    const probeBtn = h("calcite-button", { iconStart: "pin-tear", scale: "s", width: "full" });
    probeBtn.addEventListener("click", () => store.set({ mapTool: store.state.mapTool === "wind-probe" ? null : "wind-probe" }));
    const probeTable = h("table", { class: "trend-table" });
    const probeLevel = h("calcite-select", { label: "Ketinggian grafik", scale: "s" });
    for (const l of LEVELS) probeLevel.append(h("calcite-option", { value: String(l), selected: l === windStore.state.probeLevel }, `${l} m`));
    probeLevel.addEventListener("calciteSelectChange", () => windStore.set({ probeLevel: Number(probeLevel.value) }));
    const chartHost = h("div");
    const chart = createLineChart(chartHost, (i) => store.set({ timeIndex: i, playing: false, followLive: false }), 130);
    const probeBox = h("div", { class: "probe", hidden: true }, probeTable, h("calcite-label", { scale: "s" }, "Grafik kecepatan pada ketinggian", probeLevel), chartHost,
      h("p", { class: "muted small" }, "Grafik = angin bebas di titik cuaca terdekat × profil ketinggian × rasio gangguan lokal saat ini (estimasi)."));
    const clearProbe = h("calcite-button", { iconStart: "x", scale: "s", appearance: "transparent" }, "Hapus probe");
    clearProbe.addEventListener("click", () => windStore.set({ probe: null }));

    // --- what-if building tool
    const height = h("calcite-slider", { min: 10, max: 400, step: 10, value: windStore.state.placeHeight, labelHandles: true, scale: "s", attrs: { "aria-label": "Tinggi gedung (m)" } });
    height.addEventListener("calciteSliderChange", () => windStore.set({ placeHeight: Number(height.value) }));
    const size = h("calcite-slider", { min: 10, max: 200, step: 5, value: windStore.state.placeSize, labelHandles: true, scale: "s", attrs: { "aria-label": "Lebar gedung (m)" } });
    size.addEventListener("calciteSliderChange", () => windStore.set({ placeSize: Number(size.value) }));
    const place = h("calcite-button", { iconStart: "pin-plus", scale: "s", width: "full" });
    place.addEventListener("click", () => store.set({ mapTool: store.state.mapTool === "place-building" ? null : "place-building" }));
    const clear = h("calcite-button", { iconStart: "trash", scale: "s", appearance: "transparent", kind: "danger" }, "Hapus gedung what-if");
    clear.addEventListener("click", () => windStore.set({ whatIf: [] }));
    const whatIfCount = h("div", { class: "muted small" });

    store.on(["mapTool"], (s) => {
      const placing = s.mapTool === "place-building";
      place.textContent = placing ? "Selesai (klik peta untuk menaruh gedung)" : "Tambah gedung what-if dengan klik";
      place.appearance = placing ? "solid" : "outline";
      place.kind = placing ? "brand" : "neutral";
      const probing = s.mapTool === "wind-probe";
      probeBtn.textContent = probing ? "Selesai (klik peta untuk cek angin)" : "Cek kondisi angin di satu titik";
      probeBtn.appearance = probing ? "solid" : "outline";
      probeBtn.kind = probing ? "brand" : "neutral";
    }, true);

    // --- animation settings
    const slider = (label: string, key: "density" | "flowSpeed" | "trailLength", min: number, max: number, step: number) => {
      const el = h("calcite-slider", { min, max, step, value: windStore.state[key], scale: "s", attrs: { "aria-label": label } });
      el.addEventListener("calciteSliderChange", () => windStore.set({ [key]: Number(el.value) }));
      return h("calcite-label", { scale: "s" }, label, el);
    };

    const render = () => {
      const s = store.state;
      const t = s.airQuality?.times[s.timeIndex] ?? Date.now();
      const bmkgCount = config.weatherLocations.filter((loc) => {
        const fc = s.bmkg.find((b) => b.location.id === loc.id);
        return fc && slotAt(fc, t);
      }).length;
      const w = cityWeather(s);
      const src = bmkgCount
        ? `BMKG (${bmkgCount}/${config.weatherLocations.length} titik)`
        : s.weather?.synthetic
          ? "data sintetis (contoh)"
          : "Open-Meteo (BMKG tidak menyediakan data historis untuk jam ini)";
      source.replaceChildren(
        h("span", {}, h("strong", {}, "Sumber angin: "), src),
        h("span", { class: "muted" }, formatDateTime(t)),
        w ? h("span", {}, `${w.windSpeed?.toFixed(1) ?? "–"} m/s (10 m) dari ${compassLabel(w.windDirection)} (${Math.round(w.windDirection ?? 0)}°)`) : h("span", {}, "–"),
      );

      const ws = windStore.state;
      const st = ws.stats;
      stats.replaceChildren(
        h("div", { class: "muted small" }, ws.gridInfo),
        h("div", {}, h("span", { class: "muted" }, "Gedung dari scene "), h("strong", {}, ws.sceneBuildings.toLocaleString("id-ID")), h("span", { class: "muted" }, ws.sceneBuildings ? "" : " (zoom ke kawasan agar gedung terbaca)")),
        h("div", {}, h("span", { class: "muted" }, "Objek dari Tambah data "), h("strong", {}, ws.addedObstacles.toLocaleString("id-ID"))),
        h("div", {}, h("span", { class: "muted" }, "Segmen streamline "), h("strong", {}, ws.streamlineCount.toLocaleString("id-ID"))),
        ...(st
          ? [
              h("div", {}, h("span", { class: "muted" }, `Kecepatan di ${ws.animLevel} m vs tanpa penghalang `), h("strong", {}, `${Math.round(st.speedRatio * 100)}%`)),
              h("div", {}, h("span", { class: "muted" }, "Area angin lemah (< 50%) "), h("strong", {}, `${Math.round(st.calmShare * 100)}%`)),
            ]
          : []),
      );
      whatIfCount.textContent = `${ws.whatIf.length} gedung what-if`;

      // Probe
      const p = ws.probe;
      probeBox.hidden = !p;
      clearProbe.hidden = !p;
      if (p) {
        probeTable.replaceChildren(
          h("thead", {}, h("tr", {}, h("th", {}, "Tinggi"), h("th", { class: "num" }, "m/s"), h("th", {}, "Arah"), h("th", {}, "Gangguan"))),
          h(
            "tbody",
            {},
            ...(p.rows.length
              ? [...p.rows].reverse().map((r) => {
                  const color = DISTURBANCE_STOPS.reduce((acc, stp) => (r.disturbance >= stp.value ? stp.color : acc), DISTURBANCE_STOPS[0].color);
                  return h(
                    "tr",
                    {},
                    h("td", {}, `${r.level} m`),
                    h("td", { class: "num" }, r.insideBuilding ? "–" : r.speed.toFixed(1)),
                    h("td", {}, r.insideBuilding ? "dalam gedung" : `${compassLabel(r.direction)} ${r.direction != null ? Math.round(r.direction) + "°" : ""}`),
                    h("td", {}, h("span", { class: "swatch", style: `background:${color}` }), ` ${Math.round(r.disturbance * 100)}%`),
                  );
                })
              : [h("tr", {}, h("td", { attrs: { colspan: "4" } }, "Menghitung…"))]),
          ),
        );
        // Estimated local speed over the timeline at the selected height.
        const row = p.rows.find((r) => r.level === ws.probeLevel);
        const ratio = row && row.freeSpeed > 0 ? row.speed / row.freeSpeed : 1;
        const nearest = [...config.weatherLocations].sort(
          (a, b) => Math.hypot(a.latitude - p.latitude, a.longitude - p.longitude) - Math.hypot(b.latitude - p.latitude, b.longitude - p.longitude),
        )[0];
        const series = s.weather?.locations[nearest.id] ?? [];
        const pf = profileFactor(ws.probeLevel);
        chart.update({
          times: s.weather?.times ?? [],
          values: series.map((x) => (x?.windSpeed != null ? x.windSpeed * pf * ratio : null)),
          currentIndex: s.timeIndex,
          nowTime: floorHour(Date.now()),
          unit: "m/s",
          label: `Kecepatan angin ${ws.probeLevel} m di titik probe`,
        });
      }
    };
    store.on(["weather", "bmkg", "timeIndex"], render, true);
    windStore.on(["stats", "sceneBuildings", "addedObstacles", "gridInfo", "whatIf", "probe", "probeLevel", "streamlineCount", "animLevel"], render);

    return h(
      "div",
      { class: "widget" },
      source,
      sim.row,
      h("div", { class: "wind-gradient" }, h("span", {}, "Lemah"), h("div", { style: `background:${gradient.replace("to top", "to right")}` }), h("span", {}, "Kuat")),
      stats,
      h("div", { class: "section-title" }, "Cek angin di satu titik"),
      probeBtn,
      probeBox,
      clearProbe,
      h("div", { class: "section-title" }, "Gedung what-if"),
      h("calcite-label", { scale: "s" }, "Tinggi (m)", height),
      h("calcite-label", { scale: "s" }, "Lebar (m)", size),
      place,
      h("div", { class: "row-actions" }, whatIfCount, clear),
      h(
        "calcite-block",
        { heading: "Pengaturan partikel", collapsible: true, expanded: false },
        h("calcite-label", { scale: "s" }, "Ketinggian partikel", level),
        slider("Kepadatan partikel", "density", 0.1, 1, 0.05),
        slider("Kecepatan animasi", "flowSpeed", 1, 40, 1),
        slider("Panjang jejak", "trailLength", 20, 1500, 10),
      ),
      h(
        "p",
        { class: "muted small" },
        "Simulasi menampilkan partikel dan streamline 3D berwarna tingkat gangguan. Angin dibelokkan dan naik melewati gedung scene, objek 3D dari menu Tambah data (model glTF/IFC/OBJ…, CityJSON, poligon terekstrusi, I3S), gedung what-if, dan pohon. Model diagnostik (bukan CFD): angin 10 m dari titik cuaca, profil logaritmik per ketinggian, wake di belakang gedung. Zoom ke kawasan agar gedung terbaca.",
      ),
    );
  },
};
