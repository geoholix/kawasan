import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import { createFromGLTF } from "@arcgis/core/geometry/support/meshUtils";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import SketchViewModel from "@arcgis/core/widgets/Sketch/SketchViewModel";
import type { AppContext, LayerModule } from "../core/modules";
import { intersects, notifyObstaclesChanged, obstacleFromExtent, registerObstacleSource, type Obstacle } from "../core/obstacleSources";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import { addDataStore } from "./state";

import type { ConvertOptions } from "./modelConvert";

/**
 * Place 3D models in the scene, entirely in the browser. glTF / GLB is used
 * as is; IFC, OBJ, FBX, DAE and USD(Z) are first converted to GLB in the
 * browser (modelConvert, loaded on demand). The GLB becomes a Mesh
 * (meshUtils.createFromGLTF), placed with a click and can then be moved,
 * rotated and scaled (SketchViewModel). Nothing is uploaded or saved; models
 * live for the current session only.
 */

/** Formats that are placed directly. */
export const NATIVE_FORMATS = [".glb", ".gltf"];
/** Formats converted to GLB in the browser first. */
export const CONVERTED_FORMATS = [".ifc", ".obj", ".fbx", ".dae", ".usdz", ".usd", ".usda", ".usdc"];
export const MODEL_FORMATS = [...NATIVE_FORMATS, ...CONVERTED_FORMATS];
/** Files referenced by a model (materials, buffers, textures) that may be selected alongside it. */
export const COMPANION_FORMATS = [".mtl", ".bin", ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tga", ".gif"];

let ctx: AppContext | null = null;
let sketch: SketchViewModel | null = null;
const modelLayer = new GraphicsLayer({ title: "Model 3D", elevationInfo: { mode: "absolute-height" } });
const meshSymbol = { type: "mesh-3d", symbolLayers: [{ type: "fill" }] } as never;
const objectUrls = new Map<string, string>();

const extensionOf = (name: string) => name.slice(name.lastIndexOf(".")).toLowerCase();

function setStatus(text: string, kind: "success" | "danger" | "info" = "info") {
  addDataStore.set({ message: { kind, text } });
}

function syncModels() {
  addDataStore.set({
    models: modelLayer.graphics.toArray().map((g) => ({ id: g.attributes?.__id ?? "", fileName: g.attributes?.__file ?? "model", format: g.attributes?.__format ?? "glTF/GLB" })),
  });
}

/** Load a model (plus companion files), convert it if needed and start interactive placement. */
export async function importModel(files: File[], options: Omit<ConvertOptions, "onProgress">, at?: Point): Promise<void> {
  if (!ctx || !sketch || !files.length) return;
  const file = files.find((f) => MODEL_FORMATS.includes(extensionOf(f.name)));
  if (!file) {
    return setStatus(
      `Format tidak didukung (${files.map((f) => extensionOf(f.name)).join(", ")}). Gunakan glTF/GLB, IFC, OBJ, FBX, DAE, atau USDZ.`,
      "danger",
    );
  }
  const companions = files.filter((f) => f !== file && COMPANION_FORMATS.includes(extensionOf(f.name)));
  const ext = extensionOf(file.name);
  addDataStore.set({ busy: true });
  setStatus(`Memuat ${file.name}…`);
  try {
    // .glb and self-contained .gltf go straight in; everything else (incl. .gltf with external files) is converted.
    const direct = ext === ".glb" || (ext === ".gltf" && !companions.length);
    let blob: Blob = file;
    let detail = "";
    if (!direct) {
      const { convertToGlb } = await import("./modelConvert");
      const result = await convertToGlb(file, companions, { ...options, onProgress: (text) => setStatus(text) });
      blob = result.glb;
      const [w, hgt, d] = result.size.map((v) => (v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString("id-ID")));
      detail = ` Ukuran ${w} × ${d} m, tinggi ${hgt} m (satuan: ${result.unit}).`;
    }
    const url = URL.createObjectURL(blob);
    const format = NATIVE_FORMATS.includes(ext) ? "glTF/GLB" : `${ext.slice(1).toUpperCase()} → GLB`;
    await placeMesh(url, file.name, format, detail, at, true);
  } catch (err) {
    console.error(err);
    setStatus(`Gagal memuat ${file.name}: ${err instanceof Error ? err.message : String(err)}`, "danger");
  } finally {
    addDataStore.set({ busy: false });
  }
}

/**
 * Turn a GLB/glTF URL into a Mesh and either place it at `at` or let the user
 * click a location. `ownsUrl` = the URL is a blob: URL to revoke on removal.
 */
async function placeMesh(url: string, fileName: string, format: string, detail: string, at: Point | undefined, ownsUrl: boolean): Promise<void> {
  if (!ctx || !sketch) return;
  if (at && at.z == null) {
    const ground = await ctx.map.ground.queryElevation(at).catch(() => null);
    at.z = (ground?.geometry as Point | undefined)?.z ?? 0;
  }
  const origin = at ?? ((ctx.view.center?.clone() ?? new Point({ longitude: 106.8227, latitude: -6.1945 })) as Point);
  const mesh = await createFromGLTF(origin, url);
  const id = `m${Date.now().toString(36)}`;
  if (ownsUrl) objectUrls.set(id, url);
  const attributes = { __id: id, __file: fileName, __format: format };
  if (at) {
    const graphic = new Graphic({ geometry: mesh, symbol: meshSymbol, attributes });
    modelLayer.add(graphic);
    syncModels();
    void ctx.view.goTo(graphic).catch(() => {});
    return setStatus(`${fileName} ditempatkan di ${at.longitude?.toFixed(5)}, ${at.latitude?.toFixed(5)}.${detail}`, "success");
  }
  const done = sketch.on("create", (e) => {
    if (e.state !== "complete" || !e.graphic) return;
    done.remove();
    const placed = e.graphic;
    placed.attributes = attributes;
    placed.symbol = meshSymbol;
    syncModels();
    void sketch!.update(placed);
    setStatus(`${fileName} ditempatkan. Geser, putar, atau skalakan dengan manipulator; klik di luar model untuk selesai.`, "success");
  });
  void sketch.place(mesh);
  setStatus(`Klik di peta untuk menempatkan ${fileName}.${detail}`);
}

/** "106.82, -6.19" → Point, or undefined. */
export function parseLocation(text?: string): Point | undefined {
  const m = text?.match(/(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return undefined;
  const [lon, lat] = [Number(m[1]), Number(m[2])];
  return Math.abs(lon) <= 180 && Math.abs(lat) <= 90 ? new Point({ longitude: lon, latitude: lat }) : undefined;
}

/** Load a model from a URL (open model repositories, GitHub raw, …). */
export async function importModelFromUrl(url: string, options: Omit<ConvertOptions, "onProgress">, at?: Point): Promise<void> {
  const name = decodeURIComponent(new URL(url, location.href).pathname.split("/").pop() || "model.glb");
  const ext = extensionOf(name);
  if (!MODEL_FORMATS.includes(ext)) return setStatus(`URL harus berakhiran ${MODEL_FORMATS.join(", ")} (ditemukan "${ext || "tanpa ekstensi"}").`, "danger");
  // glTF/GLB load straight from the URL so relative .bin / textures resolve against it.
  if (NATIVE_FORMATS.includes(ext)) {
    addDataStore.set({ busy: true });
    setStatus(`Memuat ${name}…`);
    try {
      await placeMesh(url, name, "glTF/GLB (URL)", "", at, false);
    } catch (err) {
      setStatus(`Gagal memuat ${name}: ${err instanceof Error ? err.message : String(err)}`, "danger");
    } finally {
      addDataStore.set({ busy: false });
    }
    return;
  }
  setStatus(`Mengunduh ${name}…`);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await importModel([new File([await res.blob()], name)], options, at);
  } catch (err) {
    setStatus(`Gagal mengunduh ${name}: ${err instanceof Error ? err.message : String(err)} (periksa URL dan CORS).`, "danger");
  }
}

function graphicById(id: string): Graphic | undefined {
  return modelLayer.graphics.find((g) => g.attributes?.__id === id);
}

export function editModel(id: string): void {
  const g = graphicById(id);
  if (g && sketch) void sketch.update(g);
}

export function zoomToModel(id: string): void {
  const g = graphicById(id);
  if (g && ctx) void ctx.view.goTo(g).catch(() => {});
}

export function removeModel(id: string): void {
  const g = graphicById(id);
  if (!g) return;
  sketch?.cancel();
  modelLayer.remove(g);
  const url = objectUrls.get(id);
  if (url) URL.revokeObjectURL(url);
  objectUrls.delete(id);
  syncModels();
}

export function clearModels(): void {
  sketch?.cancel();
  modelLayer.removeAll();
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls.clear();
  syncModels();
}

export function createModelImportLayer(): LayerModule {
  return {
    id: "model-import",
    title: "Model 3D",
    description: "Model 3D yang ditempatkan lewat menu Tambah data (hanya sesi ini).",
    visibleByDefault: true,

    init(c) {
      ctx = c;
      c.map.add(modelLayer);
      sketch = new SketchViewModel({ view: c.view, layer: modelLayer });
      sketch.on("delete", syncModels);
      // Placed models block the simulated wind; recompute when they are placed, moved, removed or hidden.
      registerObstacleSource("placed-models", (extent) =>
        modelLayer.visible
          ? modelLayer.graphics
              .toArray()
              .map((g) => (g.geometry?.extent ? obstacleFromExtent(g.geometry.extent) : null))
              .filter((o): o is Obstacle => !!o && intersects(o, extent))
          : [],
      );
      modelLayer.graphics.on("change", notifyObstaclesChanged);
      sketch.on("update", (e) => e.state === "complete" && notifyObstaclesChanged());
      reactiveUtils.watch(() => modelLayer.visible, notifyObstaclesChanged);
    },

    setVisible(visible) {
      modelLayer.visible = visible;
    },
  };
}
