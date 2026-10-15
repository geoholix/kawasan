import { loadBoundaryRing, pointInRing, type Ring } from "../core/geo";
import type { WidgetModule } from "../core/modules";
import { emissionStore } from "../emissions/state";
import { formatTonnes } from "../emissions/model";
import { h } from "../ui/dom";
import { greeningStore, greeningTotals, loadSpecies, type TreePlanting } from "./state";
import { scatter } from "./treesLayer";

/** Display sample size for bulk plantings (the full count is still used in the totals). */
const BULK_SAMPLE = 400;

/** Tree planting simulation: plant by click or in bulk per kota, see CO₂ and PM2.5 effects. */
export function createTreesWidget(speciesUrl: string): WidgetModule {
  return {
    id: "trees",
    title: "Simulasi pohon",
    icon: "palette",
    placement: "start",

    create({ store, config }) {
      void loadSpecies(speciesUrl);
      let ring: Ring | null = null;
      void loadBoundaryRing(config.boundaryUrl).then((r) => (ring = r));

      const status = h("calcite-notice", { kind: "warning", scale: "s", width: "full", icon: "exclamation-mark-triangle", open: true });
      const statusMsg = h("div", { slot: "message" });
      status.append(statusMsg);

      // --- species & click planting
      const species = h("calcite-select", { label: "Spesies", scale: "s" });
      species.addEventListener("calciteSelectChange", () => greeningStore.set({ selectedSpecies: species.value }));
      const size = h("calcite-slider", { min: 1, max: 300, step: 1, value: greeningStore.state.clusterSize, labelHandles: true, scale: "s", attrs: { "aria-label": "Jumlah pohon per klik" } });
      size.addEventListener("calciteSliderChange", () => greeningStore.set({ clusterSize: Number(size.value) }));
      const radius = h("calcite-slider", { min: 5, max: 300, step: 5, value: greeningStore.state.clusterRadius, labelHandles: true, scale: "s", attrs: { "aria-label": "Radius sebaran (m)" } });
      radius.addEventListener("calciteSliderChange", () => greeningStore.set({ clusterRadius: Number(radius.value) }));

      const plantBtn = h("calcite-button", { iconStart: "pin-plus", scale: "s", width: "full" });
      plantBtn.addEventListener("click", () => store.set({ mapTool: store.state.mapTool === "plant-trees" ? null : "plant-trees" }));
      store.on(["mapTool"], (s) => {
        const on = s.mapTool === "plant-trees";
        plantBtn.textContent = on ? "Selesai menanam (klik peta untuk menanam)" : "Tanam dengan klik di peta";
        plantBtn.appearance = on ? "solid" : "outline";
        plantBtn.kind = on ? "brand" : "neutral";
      }, true);

      // --- bulk planting per kota
      const zone = h("calcite-select", { label: "Kota administrasi", scale: "s" });
      const bulkCount = h("calcite-input-number", { min: 1, max: 5_000_000, step: 1000, value: "10000", scale: "s", label: "Jumlah pohon" } as never);
      const bulkBtn = h("calcite-button", { iconStart: "plus", scale: "s", appearance: "outline" }, "Tanam massal");
      bulkBtn.addEventListener("click", () => {
        const inv = emissionStore.state.inventory;
        const z = inv?.zones.find((x) => x.id === zone.value);
        const n = Math.max(1, Math.round(Number(bulkCount.value) || 0));
        if (!z) return;
        const s = greeningStore.state;
        const sp = s.species.find((x) => x.id === s.selectedSpecies);
        const planting: TreePlanting = {
          id: `b${Date.now().toString(36)}`,
          speciesId: s.selectedSpecies,
          positions: scatter(z.longitude, z.latitude, Math.min(n, BULK_SAMPLE), 3000, (lon, lat) => !ring || pointInRing(lon, lat, ring)),
          count: n,
          label: `${n.toLocaleString("id-ID")} ${sp?.name ?? ""} di ${z.name}`,
        };
        greeningStore.set({ plantings: [...s.plantings, planting] });
      });

      // --- age, totals, list
      const age = h("calcite-slider", { min: 1, max: 30, step: 1, value: greeningStore.state.ageYears, labelHandles: true, scale: "s", attrs: { "aria-label": "Usia pohon (tahun)" } });
      age.addEventListener("calciteSliderChange", () => greeningStore.set({ ageYears: Number(age.value) }));

      const total = h("span", { class: "hero__value" });
      const totalLabel = h("div", { class: "hero__label" });
      const effects = h("div", { class: "hero__meta" });
      const list = h("div", { class: "plantings" });

      const clear = h("calcite-button", { iconStart: "trash", scale: "s", appearance: "transparent", kind: "danger" }, "Hapus semua");
      clear.addEventListener("click", () => greeningStore.set({ plantings: [] }));
      const exportBtn = h("calcite-button", { iconStart: "download", scale: "s", appearance: "transparent" }, "Ekspor GeoJSON");
      exportBtn.addEventListener("click", () => {
        const s = greeningStore.state;
        const fc = {
          type: "FeatureCollection",
          features: s.plantings.flatMap((p) =>
            p.positions.map(([lon, lat]) => ({
              type: "Feature",
              geometry: { type: "Point", coordinates: [lon, lat] },
              properties: { planting: p.id, species: p.speciesId, represents: p.count / p.positions.length },
            })),
          ),
        };
        const url = URL.createObjectURL(new Blob([JSON.stringify(fc)], { type: "application/geo+json" }));
        const a = h("a", { href: url, download: "simulasi-pohon.geojson" });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });

      const render = () => {
        const s = greeningStore.state;
        statusMsg.textContent = s.error ?? s.status ?? "";
        status.kind = s.error ? "danger" : "warning";
        if (species.childElementCount !== s.species.length) {
          species.replaceChildren(...s.species.map((sp) => h("calcite-option", { value: sp.id }, `${sp.name} (${sp.latin}) · ${sp.co2KgPerYear} kg CO₂/thn`)));
        }
        species.value = s.selectedSpecies;

        const t = greeningTotals(s);
        total.textContent = formatTonnes(t.co2TonnesPerYear).replace(" t", "");
        totalLabel.textContent = `t CO₂/tahun diserap ${t.trees.toLocaleString("id-ID")} pohon (usia ${s.ageYears} thn)`;
        const result = emissionStore.state.result;
        effects.replaceChildren(
          h("div", {}, h("span", { class: "muted" }, "PM2.5 tersaring "), h("strong", {}, `${t.pm25KgPerYear.toLocaleString("id-ID", { maximumFractionDigits: 1 })} kg/thn`)),
          ...(result
            ? [
                h("div", {}, h("span", { class: "muted" }, "Mengimbangi "), h("strong", {}, `${((t.co2TonnesPerYear / result.total) * 100).toLocaleString("id-ID", { maximumFractionDigits: 3 })}%`), h("span", { class: "muted" }, " emisi kota")),
                h("div", {}, h("span", { class: "muted" }, "Emisi bersih "), h("strong", {}, `${formatTonnes(result.total - t.co2TonnesPerYear)} CO₂e/thn`)),
              ]
            : []),
        );

        list.replaceChildren(
          ...s.plantings.map((p) => {
            const remove = h("calcite-action", { icon: "x", text: "Hapus", scale: "s" });
            remove.addEventListener("click", () => greeningStore.set({ plantings: greeningStore.state.plantings.filter((x) => x.id !== p.id) }));
            return h("div", { class: "planting" }, h("span", {}, p.label), remove);
          }),
        );
      };
      greeningStore.on(["species", "plantings", "ageYears", "selectedSpecies", "error"], render, true);
      emissionStore.on(["result", "inventory"], (e) => {
        if (e.inventory && zone.childElementCount !== e.inventory.zones.length) {
          zone.replaceChildren(...e.inventory.zones.map((z) => h("calcite-option", { value: z.id }, z.name)));
        }
        render();
      }, true);

      return h(
        "div",
        { class: "widget" },
        status,
        h("calcite-label", { scale: "s" }, "Spesies", species),
        h("div", { class: "section-title" }, "Tanam per klik"),
        h("calcite-label", { scale: "s" }, "Pohon per klik", size),
        h("calcite-label", { scale: "s" }, "Radius sebaran (m)", radius),
        plantBtn,
        h("div", { class: "section-title" }, "Tanam massal per kota"),
        h("div", { class: "bulk" }, zone, bulkCount, bulkBtn),
        h("div", { class: "section-title" }, "Dampak"),
        h("calcite-label", { scale: "s" }, "Usia pohon (tahun)", age),
        h("div", { class: "hero" }, h("div", { class: "hero__number" }, total), totalLabel, effects),
        h("div", { class: "section-title" }, "Daftar penanaman"),
        list,
        h("div", { class: "row-actions" }, exportBtn, clear),
        h("p", { class: "muted small" }, "Serapan = jumlah × serapan pohon dewasa × faktor pertumbuhan (usia). Pohon juga ditambahkan sebagai penghalang angin berpori di simulasi angin. Penanaman disimpan di browser ini."),
      );
    },
  };
}
