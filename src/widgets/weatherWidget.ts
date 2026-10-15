import type { WidgetModule } from "../core/modules";
import { weatherAt } from "../core/selectors";
import { formatDateTime } from "../core/time";
import type { WeatherSample } from "../core/types";
import { compassLabel, conditionIcon } from "../providers/weather/conditions";
import { slotAt } from "../providers/weather/bmkg";
import { h } from "../ui/dom";

function row(sample: WeatherSample) {
  return h(
    "div",
    { class: "wx__stats" },
    h("span", {}, h("calcite-icon", { icon: "brightness", scale: "s" }), ` ${sample.temperature?.toFixed(0) ?? "–"}°C`),
    h("span", {}, h("calcite-icon", { icon: "water-drop", scale: "s" }), ` ${sample.humidity != null ? Math.round(sample.humidity) : "–"}%`),
    h(
      "span",
      {},
      h("calcite-icon", { icon: "arrow-up", scale: "s", style: `transform: rotate(${(sample.windDirection ?? 0) + 180}deg)` }),
      ` ${sample.windSpeed != null ? (sample.windSpeed * 3.6).toFixed(0) : "–"} km/j ${compassLabel(sample.windDirection)}`,
    ),
    sample.visibility != null ? h("span", {}, h("calcite-icon", { icon: "view-visible", scale: "s" }), ` ${(sample.visibility / 1000).toFixed(0)} km`) : null,
  );
}

/**
 * BMKG forecast per kota administrasi at the timeline's current time. Outside
 * BMKG's 3-day window it falls back to the merged weather series (Open-Meteo).
 */
export const weatherWidget: WidgetModule = {
  id: "weather",
  title: "Cuaca BMKG",
  icon: "partly-cloudy",
  placement: "start",

  create({ store, config }) {
    const header = h("div", { class: "muted small" });
    const cards = h("div", { class: "wx" });

    store.on(["bmkg", "weather", "timeIndex"], (s) => {
      const t = s.airQuality?.times[s.timeIndex] ?? Date.now();
      const merged = weatherAt(s);
      header.textContent = `Kondisi pada ${formatDateTime(t)}`;
      cards.replaceChildren(
        ...config.weatherLocations.map((loc) => {
          const fc = s.bmkg.find((b) => b.location.id === loc.id);
          const slot = fc ? slotAt(fc, t) : null;
          const sample = slot?.sample ?? merged[loc.id] ?? null;
          const source = slot ? "BMKG" : !sample ? null : s.weather?.synthetic ? "data sintetis (contoh)" : "Open-Meteo";
          const icon = slot?.iconUrl
            ? h("img", { src: slot.iconUrl, alt: sample?.description ?? "", width: 40, height: 40 })
            : h("calcite-icon", { icon: conditionIcon(sample?.condition ?? null), scale: "l" });
          return h(
            "div",
            { class: "wx__card" },
            h("div", { class: "wx__icon" }, icon),
            h(
              "div",
              { class: "wx__body" },
              h("div", { class: "wx__title" }, loc.name),
              h("div", { class: "muted small" }, fc?.village ? `Kel. ${fc.village}, Kec. ${fc.district ?? "-"}` : loc.adm4 ? `adm4 ${loc.adm4}` : ""),
              sample ? h("div", { class: "wx__desc" }, sample.description ?? "–") : h("div", { class: "muted" }, "Tidak ada data"),
              sample ? row(sample) : null,
              source ? h("div", { class: "muted small" }, `Sumber: ${source}`) : null,
            ),
          );
        }),
      );
    }, true);

    return h(
      "div",
      { class: "widget" },
      header,
      cards,
      h("p", { class: "muted small" }, "Prakiraan BMKG tersedia 3 hari ke depan per 3 jam. Data historis menggunakan Open-Meteo karena API publik BMKG tidak menyediakan arsip."),
    );
  },
};
