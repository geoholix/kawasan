import { INDICATOR_LABELS, indicatorUnit } from "../core/ispu";
import type { AppContext, WidgetModule } from "../core/modules";
import { average, indicatorSeries } from "../core/selectors";
import { autoBinHours, binTimes, mannKendall } from "../core/trend";
import { h } from "../ui/dom";

/**
 * Trend analysis over the loaded time window: Mann-Kendall test + Sen's slope
 * per station on the same time bins the space-time cube uses.
 */
export const trendWidget: WidgetModule = {
  id: "trend",
  title: "Tren (space-time cube)",
  icon: "cube",
  placement: "start",

  create({ store, config }: AppContext) {
    const toggle = h("calcite-button", { iconStart: "cube", scale: "s", width: "full", appearance: "outline" });
    toggle.addEventListener("click", () => {
      const on = !store.state.layerVisibility["space-time-cube"];
      store.set({ layerVisibility: { ...store.state.layerVisibility, "space-time-cube": on } });
    });
    store.on(["layerVisibility"], (s) => {
      const on = !!s.layerVisibility["space-time-cube"];
      toggle.textContent = on ? "Sembunyikan space-time cube" : "Tampilkan space-time cube";
      toggle.appearance = on ? "solid" : "outline";
    }, true);

    const summary = h("div", { class: "muted small" });
    const table = h("table", { class: "trend-table" });

    store.on(["airQuality", "indicator"], (s) => {
      const times = s.airQuality?.times ?? [];
      const hours = autoBinHours(times.length);
      const bins = binTimes(times, hours);
      const unit = indicatorUnit(s.indicator);
      const perDay = 24 / hours;
      summary.textContent = `${INDICATOR_LABELS[s.indicator]}, ${bins.length} irisan × ${hours} jam. Uji Mann-Kendall (α = 0,05); kemiringan Sen per hari.`;

      const rows = config.stations.map((st) => {
        const series = indicatorSeries(s, st.id);
        const binned = bins.map((b) => average(b.indices.map((i) => series[i] ?? null)));
        return { st, r: mannKendall(binned) };
      });
      rows.sort((a, b) => (b.r?.z ?? 0) - (a.r?.z ?? 0));

      table.replaceChildren(
        h("thead", {}, h("tr", {}, h("th", {}, "Stasiun"), h("th", {}, "Tren"), h("th", { class: "num" }, `Δ/hari${unit ? ` (${unit})` : ""}`), h("th", { class: "num" }, "p"))),
        h(
          "tbody",
          {},
          ...rows.map(({ st, r }) => {
            const icon = !r ? "minus" : r.direction === "naik" ? "arrow-up-right" : r.direction === "turun" ? "arrow-down-right" : "arrow-right";
            const tr = h(
              "tr",
              { class: r?.direction === "naik" ? "up" : r?.direction === "turun" ? "down" : "" },
              h("td", {}, st.name),
              h("td", {}, h("calcite-icon", { icon, scale: "s" }), ` ${r?.direction ?? "data kurang"}`),
              h("td", { class: "num" }, r ? (r.slope * perDay).toFixed(1) : "–"),
              h("td", { class: "num" }, r ? (r.p < 0.001 ? "<0,001" : r.p.toFixed(3)) : "–"),
            );
            tr.addEventListener("click", () => store.set({ selectedStationId: st.id }));
            return tr;
          }),
        ),
      );
    }, true);

    return h(
      "div",
      { class: "widget" },
      toggle,
      h("p", { class: "muted small" }, "Setiap stasiun ditampilkan sebagai tumpukan voxel: semakin ke atas semakin baru. Warna = kategori ISPU rata-rata irisan; irisan terang = jam aktif pada timeline. Gunakan mode Historis dengan rentang beberapa hari/minggu untuk melihat tren."),
      summary,
      table,
    );
  },
};
