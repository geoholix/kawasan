import type { LayerModule, WidgetModule } from "../core/modules";
import { h } from "../ui/dom";

const basemapLabel = (id: string) => (id.startsWith("item:") ? `Item ArcGIS ${id.slice(5, 11)}…` : id);

/** Generic layer list: one switch per registered layer module, plus its legend and controls. */
export function createLayersWidget(layers: LayerModule[]): WidgetModule {
  return {
    id: "layers",
    title: "Layer & legenda",
    icon: "layers",
    placement: "start",

    create({ store, config }) {
      // Basemap picker: 3D basemaps carry their own buildings, 2D ones fall back to OSM buildings.
      const basemap = h("calcite-select", { label: "Basemap", scale: "s" });
      const options = config.basemapOptions.some((o) => o.id === store.state.basemap)
        ? config.basemapOptions
        : [...config.basemapOptions, { id: store.state.basemap, label: basemapLabel(store.state.basemap) }];
      for (const o of options) basemap.append(h("calcite-option", { value: o.id }, o.label));
      basemap.addEventListener("calciteSelectChange", () => store.set({ basemap: basemap.value }));
      store.on(["basemap"], (s) => {
        if (![...basemap.querySelectorAll("calcite-option")].some((o) => o.value === s.basemap)) {
          basemap.append(h("calcite-option", { value: s.basemap }, basemapLabel(s.basemap)));
        }
        basemap.value = s.basemap;
      }, true);
      const basemapBlock = h("calcite-block", { heading: "Basemap", description: "Basemap 3D ArcGIS berisi bangunan, label, dan pohon 3D.", expanded: true, collapsible: true },
        h("calcite-label", { scale: "s" }, "Pilih basemap", basemap),
      );

      const blocks = layers.map((layer) => {
        const toggle = h("calcite-switch", { checked: store.state.layerVisibility[layer.id] ?? layer.visibleByDefault, label: layer.title });
        toggle.addEventListener("calciteSwitchChange", () => {
          store.set({ layerVisibility: { ...store.state.layerVisibility, [layer.id]: toggle.checked } });
        });

        const legend = layer.legend?.length
          ? h(
              "ul",
              { class: "legend" },
              ...layer.legend.map((item) =>
                h(
                  "li",
                  {},
                  item.color ? h("span", { class: "swatch", style: `background:${item.color}` }) : null,
                  item.icon ? h("calcite-icon", { icon: item.icon, scale: "s" }) : null,
                  h("span", {}, item.label),
                ),
              ),
            )
          : null;

        const controls = (layer.controls ?? []).map((c) => {
          const slider = h("calcite-slider", { min: c.min, max: c.max, step: c.step, value: c.value, scale: "s", attrs: { "aria-label": c.label } });
          slider.addEventListener("calciteSliderInput", () => c.onChange(Number(slider.value)));
          return h("calcite-label", { scale: "s" }, c.label, slider);
        });

        return h(
          "calcite-block",
          { heading: layer.title, description: layer.description ?? "", expanded: !!legend || controls.length > 0, collapsible: true },
          h("div", { slot: "actions-end", class: "block-switch" }, toggle),
          ...controls,
          legend,
        );
      });

      return h("div", { class: "widget widget--flush" }, basemapBlock, ...blocks);
    },
  };
}
