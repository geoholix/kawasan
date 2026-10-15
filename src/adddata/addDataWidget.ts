import type { AppContext, WidgetModule } from "../core/modules";
import { h } from "../ui/dom";
import { createLayer, setViewProvider, SOURCE_OPTIONS, TYPE_LABELS } from "./layerFactory";
import type { ModelUnit } from "./modelConvert";
import { clearModels, COMPANION_FORMATS, editModel, importModel, importModelFromUrl, MODEL_FORMATS, parseLocation, removeModel, zoomToModel } from "./modelImport";
import { addDataStore, savedSpecs, type SourceSpec } from "./state";

type Section = "service" | "file" | "model";

/** "Tambah data": add ArcGIS / OGC services, open 3D services (I3S, 3D Tiles, CityJSON), CSV & GeoJSON, and 3D models (glTF, IFC, OBJ …). */
export const addDataWidget: WidgetModule = {
  id: "add-data",
  title: "Tambah data",
  icon: "add-layer",
  placement: "start",

  create(ctx: AppContext) {
    const { map, view } = ctx;
    setViewProvider(() => view);

    const addSource = async (spec: SourceSpec, persistent: boolean) => {
      addDataStore.set({ busy: true, message: { kind: "info", text: `Memuat ${TYPE_LABELS[spec.kind]}…` } });
      try {
        const layer = await createLayer(spec);
        map.add(layer);
        const entry = { id: layer.id, spec, title: layer.title || spec.url, typeLabel: TYPE_LABELS[spec.kind], layer, persistent };
        addDataStore.set({ entries: [...addDataStore.state.entries, entry], message: { kind: "success", text: `"${entry.title}" ditambahkan.` } });
        if (layer.fullExtent) void view.goTo(layer.fullExtent).catch(() => {});
      } catch (err) {
        addDataStore.set({ message: { kind: "danger", text: `Gagal menambah data: ${err instanceof Error ? err.message : String(err)}` } });
      } finally {
        addDataStore.set({ busy: false });
      }
    };

    // Restore URL-based layers added in an earlier session (best effort).
    for (const spec of savedSpecs()) void addSource(spec, true);

    // --- section switcher
    const sections = h("calcite-segmented-control", { scale: "s", width: "full", attrs: { "aria-label": "Jenis data" } });
    const sectionDefs: { id: Section; label: string }[] = [
      { id: "service", label: "Layanan / URL" },
      { id: "file", label: "Berkas" },
      { id: "model", label: "Model 3D" },
    ];
    for (const s of sectionDefs) sections.append(h("calcite-segmented-control-item", { value: s.id, checked: s.id === "service" }, s.label));

    // --- service / URL
    const kind = h("calcite-select", { label: "Jenis layer", scale: "s" });
    for (const group of ["ArcGIS", "OGC", "3D terbuka", "Berkas / format terbuka"] as const) {
      const og = h("calcite-option-group", { label: group });
      for (const o of SOURCE_OPTIONS.filter((x) => x.group === group)) og.append(h("calcite-option", { value: o.kind }, o.label));
      kind.append(og);
    }
    const urlLabel = h("span");
    const url = h("calcite-input-text", { scale: "s", placeholder: "" });
    const paramLabel = h("span");
    const param = h("calcite-input-text", { scale: "s" });
    const paramRow = h("calcite-label", { scale: "s" }, paramLabel, param);
    const title = h("calcite-input-text", { scale: "s", placeholder: "Nama layer (opsional)" });
    const hint = h("div", { class: "muted small" });
    const extrude = h("calcite-checkbox", { scale: "s" });
    const extrudeRow = h("calcite-label", { scale: "s", layout: "inline" }, extrude, "Ekstrusi poligon sebagai bangunan 3D (field tinggi / jumlah lantai dideteksi otomatis)");
    const addBtn = h("calcite-button", { iconStart: "add-layer", scale: "s", width: "full" }, "Tambah ke peta");

    const syncKind = () => {
      const o = SOURCE_OPTIONS.find((x) => x.kind === kind.value) ?? SOURCE_OPTIONS[0];
      urlLabel.textContent = o.urlLabel;
      url.placeholder = o.placeholder;
      paramRow.hidden = !o.paramLabel;
      paramLabel.textContent = o.paramLabel ?? "";
      hint.textContent = o.hint;
      extrudeRow.hidden = !o.extrudable;
      addBtn.textContent = o.kind === "model-url" ? "Muat model" : "Tambah ke peta";
    };
    kind.addEventListener("calciteSelectChange", syncKind);
    syncKind();
    addBtn.addEventListener("click", () => {
      if (!url.value.trim()) return;
      const spec: SourceSpec = {
        kind: kind.value as SourceSpec["kind"],
        url: url.value.trim(),
        param: param.value.trim() || undefined,
        title: title.value.trim() || undefined,
        extrude: !extrudeRow.hidden && extrude.checked ? true : undefined,
      };
      const run = spec.kind === "model-url" ? importModelFromUrl(spec.url, modelOptions(), parseLocation(spec.param)) : addSource(spec, true);
      void run.then(() => {
        url.value = "";
        param.value = "";
        title.value = "";
      });
    });
    const serviceBox = h(
      "div",
      { class: "widget-section" },
      h("calcite-label", { scale: "s" }, "Jenis layer", kind),
      h("calcite-label", { scale: "s" }, urlLabel, url),
      paramRow,
      h("calcite-label", { scale: "s" }, "Nama", title),
      extrudeRow,
      hint,
      addBtn,
    );

    // --- local files (CSV / GeoJSON / CityJSON)
    const fileInput = h("input", { type: "file", accept: ".csv,.geojson,.json,.cityjson", multiple: true, hidden: true });
    const fileExtrude = h("calcite-checkbox", { scale: "s" });
    const isCityJson = async (f: File) => /\.cityjson$/i.test(f.name) || (/\.json$/i.test(f.name) && /"type"\s*:\s*"CityJSON"/.test(await f.slice(0, 4096).text()));
    const addFiles = async (files: File[]) => {
      for (const f of files) {
        const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
        const k = (await isCityJson(f)) ? "file-cityjson" : ext === ".csv" ? "file-csv" : ext === ".geojson" || ext === ".json" ? "file-geojson" : null;
        if (!k) {
          addDataStore.set({ message: { kind: "danger", text: `${f.name}: format tidak didukung di sini (gunakan CSV, GeoJSON, atau CityJSON; model 3D di tab Model 3D).` } });
          continue;
        }
        const extrudeFile = k === "file-geojson" && fileExtrude.checked ? true : undefined;
        await addSource({ kind: k, url: URL.createObjectURL(f), title: f.name.replace(/\.(city\.)?[^.]+$/, ""), extrude: extrudeFile }, false);
      }
    };
    fileInput.addEventListener("change", () => {
      void addFiles([...(fileInput.files ?? [])]);
      fileInput.value = "";
    });
    const pickFile = h("calcite-button", { iconStart: "upload", scale: "s", width: "full", appearance: "outline" }, "Pilih berkas CSV / GeoJSON / CityJSON");
    pickFile.addEventListener("click", () => fileInput.click());
    const fileBox = h(
      "div",
      { class: "widget-section", hidden: true },
      dropZone("Tarik & lepas berkas CSV, GeoJSON, atau CityJSON di sini", (files) => void addFiles(files)),
      pickFile,
      fileInput,
      h("calcite-label", { scale: "s", layout: "inline" }, fileExtrude, "Ekstrusi poligon GeoJSON sebagai bangunan 3D"),
      h(
        "p",
        { class: "muted small" },
        "CSV: kolom koordinat (lat/lon, latitude/longitude, y/x) dideteksi otomatis. GeoJSON: FeatureCollection WGS84; ekstrusi memakai field tinggi (height, render_height, …) atau jumlah lantai (num_floors, building:levels, …). CityJSON: dikonversi ke mesh 3D di browser. Berkas lokal tidak disimpan setelah halaman dimuat ulang.",
      ),
    );

    // --- 3D models (glTF/GLB placed directly; IFC, OBJ, FBX, DAE, USDZ converted in the browser)
    const unit = h("calcite-select", { label: "Satuan model", scale: "s" });
    for (const [value, label] of [
      ["auto", "Otomatis"],
      ["m", "Meter"],
      ["cm", "Sentimeter"],
      ["mm", "Milimeter"],
      ["ft", "Kaki (ft)"],
      ["in", "Inci (in)"],
    ]) unit.append(h("calcite-option", { value }, label));
    const zUp = h("calcite-checkbox", { scale: "s" });
    function modelOptions() {
      return { unit: unit.value as ModelUnit, zUp: zUp.checked };
    }
    const placeModel = (files: File[]) => void importModel(files, modelOptions());

    const modelInput = h("input", { type: "file", accept: [...MODEL_FORMATS, ...COMPANION_FORMATS].join(","), multiple: true, hidden: true });
    modelInput.addEventListener("change", () => {
      placeModel([...(modelInput.files ?? [])]);
      modelInput.value = "";
    });
    const pickModel = h("calcite-button", { iconStart: "cube", scale: "s", width: "full" }, "Pilih model 3D");
    pickModel.addEventListener("click", () => modelInput.click());
    const modelList = h("div", { class: "added-list" });
    const clearAll = h("calcite-button", { iconStart: "trash", scale: "s", appearance: "transparent", kind: "danger" }, "Hapus semua model");
    clearAll.addEventListener("click", clearModels);
    const modelBox = h(
      "div",
      { class: "widget-section", hidden: true },
      dropZone("Tarik & lepas model 3D di sini (glTF/GLB, IFC, OBJ, FBX, DAE, USDZ)", placeModel),
      pickModel,
      modelInput,
      h("calcite-label", { scale: "s" }, "Satuan (untuk OBJ/FBX/USDZ)", unit),
      h("calcite-label", { scale: "s", layout: "inline" }, zUp, "Model Z-up (putar agar tegak)"),
      h("div", { class: "section-title" }, "Model di peta"),
      modelList,
      clearAll,
      h(
        "p",
        { class: "muted small" },
        "Semua diproses di browser: glTF/GLB langsung ditempatkan; IFC, OBJ, FBX, DAE, dan USDZ dikonversi dulu ke GLB (web-ifc / three.js). Pilih berkas pendukung (.mtl, .bin, tekstur) bersamaan dengan modelnya. Klik di peta untuk menempatkan, lalu geser, putar, dan skalakan. Model tidak diunggah atau disimpan dan hilang saat halaman dimuat ulang. Model besar (IFC puluhan MB) bisa butuh waktu.",
      ),
    );

    sections.addEventListener("calciteSegmentedControlChange", () => {
      const v = sections.value as Section;
      serviceBox.hidden = v !== "service";
      fileBox.hidden = v !== "file";
      modelBox.hidden = v !== "model";
    });

    // --- shared: status + added layers
    const notice = h("calcite-notice", { scale: "s", width: "full", open: false, closable: true });
    const noticeMsg = h("div", { slot: "message" });
    notice.append(noticeMsg);
    const loader = h("calcite-loader", { inline: true, label: "Memuat", hidden: true });
    const list = h("div", { class: "added-list" });

    addDataStore.on(["message", "busy", "entries", "models"], (s) => {
      notice.open = !!s.message;
      notice.kind = s.message?.kind === "danger" ? "danger" : s.message?.kind === "success" ? "success" : "brand";
      noticeMsg.textContent = s.message?.text ?? "";
      loader.hidden = !s.busy;
      addBtn.disabled = s.busy;
      clearAll.hidden = !s.models.length;
      modelList.replaceChildren(
        ...(s.models.length
          ? s.models.map((m) => {
              const edit = h("calcite-action", { icon: "move", text: "Geser / putar / skala", scale: "s" });
              edit.addEventListener("click", () => editModel(m.id));
              const zoom = h("calcite-action", { icon: "zoom-to-object", text: "Perbesar ke model", scale: "s" });
              zoom.addEventListener("click", () => zoomToModel(m.id));
              const remove = h("calcite-action", { icon: "trash", text: "Hapus", scale: "s" });
              remove.addEventListener("click", () => removeModel(m.id));
              return h("div", { class: "added-item" }, h("div", { class: "added-item__text" }, h("strong", {}, m.fileName), h("span", { class: "muted small" }, `${m.format} · sesi ini`)), edit, zoom, remove);
            })
          : [h("div", { class: "muted small" }, "Belum ada model.")]),
      );

      list.replaceChildren(
        ...(s.entries.length
          ? s.entries.map((e) => {
              const vis = h("calcite-action", { icon: e.layer.visible ? "view-visible" : "view-hide", text: "Tampilkan/sembunyikan", scale: "s" });
              vis.addEventListener("click", () => {
                e.layer.visible = !e.layer.visible;
                vis.icon = e.layer.visible ? "view-visible" : "view-hide";
              });
              const zoom = h("calcite-action", { icon: "zoom-to-object", text: "Perbesar ke layer", scale: "s" });
              zoom.addEventListener("click", () => e.layer.fullExtent && void view.goTo(e.layer.fullExtent).catch(() => {}));
              const remove = h("calcite-action", { icon: "trash", text: "Hapus", scale: "s" });
              remove.addEventListener("click", () => {
                map.remove(e.layer);
                if (e.spec.url.startsWith("blob:")) URL.revokeObjectURL(e.spec.url);
                addDataStore.set({ entries: addDataStore.state.entries.filter((x) => x.id !== e.id) });
              });
              return h(
                "div",
                { class: "added-item" },
                h("div", { class: "added-item__text" }, h("strong", {}, e.title), h("span", { class: "muted small" }, `${e.typeLabel}${e.persistent ? "" : " · tidak disimpan"}`)),
                vis,
                zoom,
                remove,
              );
            })
          : [h("div", { class: "muted small" }, "Belum ada data tambahan.")]),
      );
    }, true);

    return h(
      "div",
      { class: "widget" },
      sections,
      serviceBox,
      fileBox,
      modelBox,
      h("div", { class: "row-actions" }, h("span", { class: "section-title" }, "Layer yang ditambahkan"), loader),
      notice,
      list,
    );
  },
};

/** Drag-and-drop target that hands dropped files to `onFiles`. */
function dropZone(text: string, onFiles: (files: File[]) => void): HTMLElement {
  const el = h("div", { class: "drop-zone" }, h("calcite-icon", { icon: "upload", scale: "m" }), h("span", {}, text));
  el.addEventListener("dragover", (e) => {
    e.preventDefault();
    el.classList.add("drop-zone--over");
  });
  el.addEventListener("dragleave", () => el.classList.remove("drop-zone--over"));
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    el.classList.remove("drop-zone--over");
    onFiles([...(e.dataTransfer?.files ?? [])]);
  });
  return el;
}
