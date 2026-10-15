import type { WidgetModule } from "../core/modules";
import { formatDateTime } from "../core/time";
import { greeningStore, greeningTotals } from "../greening/state";
import { h } from "../ui/dom";
import { BASELINE, formatTonnes, hourlyRate, SECTOR_COLORS, SECTORS, sumTotals, type Scenario } from "./model";
import { emissionStore, loadInventory } from "./state";

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Emission estimate, breakdown per sector and kota, and what-if scenario levers. */
export function createEmissionWidget(inventoryUrl: string): WidgetModule {
  return {
    id: "emissions",
    title: "Emisi karbon (estimasi)",
    icon: "effects",
    placement: "start",

    create({ store }) {
      void loadInventory(inventoryUrl);

      const status = h("calcite-notice", { kind: "warning", scale: "s", width: "full", icon: "exclamation-mark-triangle", open: true });
      const statusMsg = h("div", { slot: "message" });
      status.append(statusMsg);

      const toggle = h("calcite-button", { iconStart: "layers", scale: "s", width: "full", appearance: "outline" });
      toggle.addEventListener("click", () => {
        const on = !store.state.layerVisibility.emissions;
        store.set({ layerVisibility: { ...store.state.layerVisibility, emissions: on } });
      });
      store.on(["layerVisibility"], (s) => {
        toggle.textContent = s.layerVisibility.emissions ? "Sembunyikan kolom emisi 3D" : "Tampilkan kolom emisi 3D";
        toggle.appearance = s.layerVisibility.emissions ? "solid" : "outline";
      }, true);

      const total = h("span", { class: "hero__value" });
      const delta = h("div", { class: "hero__label" });
      const rateNow = h("div", { class: "hero__label" });
      const net = h("div", { class: "hero__meta" });
      const sectors = h("table", { class: "trend-table" });
      const zones = h("table", { class: "trend-table" });

      // Scenario levers
      const levers = h("div", { class: "levers" });
      const sliders: { el: HTMLElementTagNameMap["calcite-slider"]; apply: (s: Scenario, v: number) => Scenario; read: (s: Scenario) => number }[] = [];
      const addLever = (label: string, max: number, read: (s: Scenario) => number, apply: (s: Scenario, v: number) => Scenario) => {
        const el = h("calcite-slider", { min: 0, max, step: 5, value: 0, scale: "s", labelText: label, labelHandles: true });
        el.addEventListener("calciteSliderChange", () => {
          emissionStore.set({ scenario: apply(emissionStore.state.scenario, Number(el.value) / 100) });
        });
        sliders.push({ el, apply, read });
        levers.append(h("calcite-label", { scale: "s" }, `${label} (%)`, el));
      };

      const reset = h("calcite-button", { iconStart: "reset", scale: "s", appearance: "transparent" }, "Reset skenario");
      reset.addEventListener("click", () => emissionStore.set({ scenario: BASELINE }));

      let leversBuilt = false;
      const buildLevers = () => {
        const inv = emissionStore.state.inventory;
        if (!inv || leversBuilt) return;
        leversBuilt = true;
        for (const v of inv.activity.vehicles) {
          addLever(`Kendaraan listrik: ${v.label}`, 100, (s) => s.evShare[v.id] ?? 0, (s, x) => ({ ...s, evShare: { ...s.evShare, [v.id]: x } }));
        }
        addLever("Pengurangan km kendaraan", 50, (s) => s.vktReduction, (s, x) => ({ ...s, vktReduction: x }));
        addLever("Listrik energi terbarukan", 100, (s) => s.renewableShare, (s, x) => ({ ...s, renewableShare: x }));
        addLever("Pengurangan sampah ke TPA", 80, (s) => s.wasteReduction, (s, x) => ({ ...s, wasteReduction: x }));
        levers.append(reset);
      };

      const render = () => {
        const { inventory, result, baseline, scenario, error } = emissionStore.state;
        statusMsg.textContent = error ?? inventory?.status ?? "Memuat inventaris emisi…";
        status.kind = error ? "danger" : "warning";
        if (!inventory || !result || !baseline) return;
        buildLevers();
        for (const s of sliders) s.el.value = Math.round(s.read(scenario) * 100);

        const theme = store.state.theme;
        const t = store.state.airQuality?.times[store.state.timeIndex] ?? Date.now();
        total.textContent = (result.total / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 });
        const change = result.total / baseline.total - 1;
        delta.textContent = `juta t CO₂e/tahun · ${Math.abs(change) < 0.0005 ? "baseline" : `${change < 0 ? "−" : "+"}${Math.abs(change * 100).toFixed(1)}% vs baseline`}`;
        const rate = sumTotals(hourlyRate(result.city, t));
        rateNow.textContent = `Laju pada ${formatDateTime(t)}: ${formatTonnes(rate)} CO₂e/jam`;
        const trees = greeningTotals(greeningStore.state);
        net.replaceChildren(
          ...(trees.trees
            ? [
                h("div", {}, h("span", { class: "muted" }, `Penyerapan ${trees.trees.toLocaleString("id-ID")} pohon (simulasi) `), h("strong", {}, `−${formatTonnes(trees.co2TonnesPerYear)}`)),
                h("div", {}, h("span", { class: "muted" }, "Emisi bersih "), h("strong", {}, `${formatTonnes(result.total - trees.co2TonnesPerYear)} CO₂e/thn`)),
              ]
            : [h("div", { class: "muted small" }, "Tambahkan pohon di widget Simulasi pohon untuk melihat emisi bersih.")]),
        );

        const max = Math.max(...SECTORS.map((s) => result.city[s.id]));
        sectors.replaceChildren(
          h("thead", {}, h("tr", {}, h("th", {}, "Sektor"), h("th", { class: "num" }, "t CO₂e/thn"), h("th", { class: "num" }, "Porsi"))),
          h(
            "tbody",
            {},
            ...SECTORS.map((s) =>
              h(
                "tr",
                {},
                h(
                  "td",
                  {},
                  h("div", { class: "legend-row" }, h("span", { class: "swatch", style: `background:${SECTOR_COLORS[theme][s.id]}` }), s.label),
                  h("div", { class: "bar" }, h("span", { style: `width:${(result.city[s.id] / max) * 100}%;background:${SECTOR_COLORS[theme][s.id]}` })),
                ),
                h("td", { class: "num" }, formatTonnes(result.city[s.id])),
                h("td", { class: "num" }, pct(result.city[s.id] / result.total)),
              ),
            ),
          ),
        );

        zones.replaceChildren(
          h("thead", {}, h("tr", {}, h("th", {}, "Kota administrasi"), h("th", { class: "num" }, "t CO₂e/thn"), h("th", { class: "num" }, "t/kapita"))),
          h(
            "tbody",
            {},
            ...inventory.zones.map((z) => {
              const zt = sumTotals(result.zones[z.id]);
              return h("tr", {}, h("td", {}, z.name), h("td", { class: "num" }, formatTonnes(zt)), h("td", { class: "num" }, (zt / z.population).toFixed(1)));
            }),
          ),
        );
      };

      emissionStore.on(["inventory", "result", "error"], render, true);
      store.on(["timeIndex", "airQuality", "theme"], render);
      greeningStore.on(["plantings", "ageYears", "species"], render);

      return h(
        "div",
        { class: "widget" },
        status,
        toggle,
        h("div", { class: "hero" }, h("div", { class: "hero__number" }, total), delta, rateNow, net),
        h("div", { class: "section-title" }, "Per sektor"),
        sectors,
        h("div", { class: "section-title" }, "Per kota administrasi"),
        zones,
        h("div", { class: "section-title" }, "Skenario (what-if)"),
        levers,
        h(
          "p",
          { class: "muted small" },
          "Metode: data aktivitas × faktor emisi (IPCC 2006). Kendaraan listrik memindahkan emisi ke sektor listrik sesuai faktor emisi grid. Laju per jam mengikuti profil harian tiap sektor. Ubah angka di public/data/emission-inventory.json.",
        ),
      );
    },
  };
}
