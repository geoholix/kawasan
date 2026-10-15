import type { ModuleRegistry, WidgetModule } from "../core/modules";
import { formatDateTime } from "../core/time";
import { h } from "../ui/dom";

/** Data sources, attribution and the status of the last load. */
export function createAboutWidget(registry: ModuleRegistry): WidgetModule {
  return {
    id: "about",
    title: "Sumber data & info",
    icon: "information",
    placement: "start",

    create({ store, config }) {
      const status = h("div", { class: "about__status" });
      const providers = [...registry.airQualityProviders, ...registry.weatherProviders];

      store.on(["airQuality", "weather", "bmkg", "lastUpdated"], (s) => {
        const active = new Set([...(s.airQuality?.sources ?? []), ...(s.weather?.sources ?? []), ...(s.bmkg.length ? ["bmkg"] : [])]);
        status.replaceChildren(
          h("div", { class: "muted small" }, s.lastUpdated ? `Dimuat ${formatDateTime(s.lastUpdated)}` : "Belum dimuat"),
          h(
            "ul",
            { class: "legend" },
            ...providers.map((p) =>
              h(
                "li",
                {},
                h("calcite-icon", { icon: active.has(p.id) ? "check-circle-f" : "circle", scale: "s" }),
                h("span", {}, h("strong", {}, p.label), h("br"), h("span", { class: "muted small" }, p.attribution)),
              ),
            ),
          ),
        );
      }, true);

      return h(
        "div",
        { class: "widget" },
        h("p", {}, `${config.title} menampilkan kawasan SCBD dan PIK (web map Analisis Kawasan) dalam 3D dan 2D, serta polusi udara dan cuaca DKI Jakarta: historis, real-time, dan prakiraan.`),
        h("div", { class: "section-title" }, "Status sumber data"),
        status,
        h("div", { class: "section-title" }, "Catatan"),
        h(
          "ul",
          { class: "notes" },
          h("li", {}, "ISPU dihitung dari nilai per jam sehingga bersifat indikatif; ISPU resmi memakai rata-rata 24 jam (PM) dan 8 jam (CO)."),
          h("li", {}, "Model CAMS global beresolusi ~45 km, sehingga perbedaan antar titik di Jakarta kecil. Integrasi data SPKU (udara.jakarta.go.id) memberi variasi spasial yang nyata."),
          h("li", {}, "Indeks permukaan polusi adalah interpolasi IDW antar titik, bukan pengukuran per sel."),
          h("li", {}, "Bangunan 3D: basemap 3D ArcGIS (Esri); cadangan OpenStreetMap 3D Buildings. © kontributor OpenStreetMap."),
        ),
      );
    },
  };
}
