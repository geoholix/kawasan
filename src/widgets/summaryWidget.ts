import { categoryOf, INDICATOR_LABELS, indicatorUnit } from "../core/ispu";
import type { WidgetModule } from "../core/modules";
import { citySummary, cityWeather, readingsAt } from "../core/selectors";
import { compassLabel } from "../providers/weather/conditions";
import { cameraAt } from "../core/camera";
import { h } from "../ui/dom";

/** City-wide headline: average value, ISPU category, dominant pollutant, station ranking. */
export const summaryWidget: WidgetModule = {
  id: "summary",
  title: "Ringkasan kota",
  icon: "dashboard",
  placement: "end",

  create({ store, config, view }) {
    const notice = h("calcite-notice", { kind: "warning", scale: "s", width: "full", icon: "exclamation-mark-triangle", open: false },
      h("div", { slot: "message" }, "Sumber data tidak dapat diakses. Menampilkan data contoh (sintetis), bukan pengukuran."),
    );
    const error = h("calcite-notice", { kind: "danger", scale: "s", width: "full", icon: "x-octagon", open: false });
    const errorMsg = h("div", { slot: "message" });
    error.append(errorMsg);

    const value = h("span", { class: "hero__value" });
    const unit = h("span", { class: "hero__unit" });
    const label = h("div", { class: "hero__label" });
    const chip = h("calcite-chip", { scale: "s", label: "Kategori ISPU" });
    const meta = h("div", { class: "hero__meta" });
    const weather = h("div", { class: "hero__weather" });
    const list = h("calcite-list", { label: "Stasiun", selectionMode: "single", selectionAppearance: "border", scale: "s" });

    list.addEventListener("calciteListItemSelect", (e) => {
      const id = (e.target as HTMLElement).getAttribute("data-station");
      if (!id) return;
      store.set({ selectedStationId: id });
      // Fly to the station, keeping the current viewing direction.
      const st = config.stations.find((s) => s.id === id);
      if (st) void view.goTo(cameraAt(st.longitude, st.latitude, undefined, undefined, view.camera?.heading ?? 0), { duration: 1500 }).catch(() => {});
    });

    const stations = new Map(config.stations.map((s) => [s.id, s]));

    store.on(["airQuality", "weather", "timeIndex", "indicator", "selectedStationId", "error", "layerErrors"], (s) => {
      notice.open = !!s.airQuality?.synthetic;
      const messages = [s.error, ...Object.values(s.layerErrors)].filter(Boolean);
      error.open = messages.length > 0;
      errorMsg.textContent = messages.join(" · ");

      const sum = citySummary(s);
      const u = indicatorUnit(s.indicator);
      value.textContent = sum.value == null ? "–" : Math.round(sum.value).toString();
      unit.textContent = u;
      label.textContent = `Rata-rata ${INDICATOR_LABELS[s.indicator]} ${config.stations.length} titik`;
      const cat = sum.category;
      chip.textContent = cat ? cat.label : "Tidak ada data";
      chip.icon = cat?.icon ?? "question";
      chip.style.setProperty("--calcite-chip-background-color", cat ? `${cat.color}33` : "");
      chip.style.setProperty("--calcite-chip-border-color", cat?.color ?? "");
      meta.replaceChildren(
        h("div", {}, h("span", { class: "muted" }, "Polutan dominan "), h("strong", {}, sum.dominant ? INDICATOR_LABELS[sum.dominant] : "–")),
        h("div", {}, h("span", { class: "muted" }, "Terburuk "), h("strong", {}, sum.worst ? stations.get(sum.worst.stationId)?.name ?? "" : "–")),
        ...(cat ? [h("div", { class: "muted small" }, cat.advice)] : []),
      );

      const w = cityWeather(s);
      weather.replaceChildren(
        ...(w
          ? [
              h("span", {}, h("calcite-icon", { icon: "brightness", scale: "s" }), ` ${w.temperature?.toFixed(1) ?? "–"}°C`),
              h("span", {}, h("calcite-icon", { icon: "water-drop", scale: "s" }), ` ${w.humidity != null ? Math.round(w.humidity) : "–"}%`),
              h("span", {}, h("calcite-icon", { icon: "arrow-up", scale: "s", style: `transform: rotate(${(w.windDirection ?? 0) + 180}deg)` }), ` ${w.windSpeed?.toFixed(1) ?? "–"} m/s ${compassLabel(w.windDirection)}`),
              ...(w.description ? [h("span", { class: "muted" }, w.description)] : []),
            ]
          : [h("span", { class: "muted" }, "Data cuaca tidak tersedia")]),
      );

      const readings = readingsAt(s).sort((a, b) => (b.index ?? -1) - (a.index ?? -1));
      list.replaceChildren(
        ...readings.map((r) => {
          const st = stations.get(r.stationId)!;
          const c = categoryOf(r.index);
          const item = h("calcite-list-item", {
            label: st.name,
            description: `${c?.label ?? "Tidak ada data"} · ${st.kind === "model" ? "titik model" : st.kind === "embassy" ? "US Embassy" : "SPKU"}`,
            selected: s.selectedStationId === r.stationId,
          });
          item.setAttribute("data-station", r.stationId);
          const swatch = h("span", { slot: "content-start", class: "swatch", style: `background:${c?.color ?? "#8a8f98"}` });
          const val = h("span", { slot: "content-end", class: "value" }, r.value == null ? "–" : `${Math.round(r.value)}`);
          item.append(swatch, val);
          return item;
        }),
      );
    }, true);

    return h(
      "div",
      { class: "widget summary" },
      notice,
      error,
      h("div", { class: "hero" }, h("div", { class: "hero__number" }, value, unit), label, chip, meta),
      weather,
      h("div", { class: "section-title" }, "Stasiun (klik untuk grafik)"),
      list,
    );
  },
};
