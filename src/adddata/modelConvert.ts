import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  LoadingManager,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type Object3D,
} from "three";
import { ColladaLoader } from "three/addons/loaders/ColladaLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { USDLoader } from "three/addons/loaders/USDLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import webIfcWasmUrl from "web-ifc/web-ifc.wasm?url";

/**
 * Browser-side conversion of IFC / OBJ / FBX / DAE / USD(Z) (and glTF with
 * external files) to a single GLB. Loaded on demand so three.js and web-ifc
 * stay out of the main bundle. Nothing leaves the user's machine.
 *
 * The result is normalised for placement: metres, Y-up, origin at the centre
 * of the model's base.
 */

export type ModelUnit = "auto" | "m" | "cm" | "mm" | "ft" | "in";

export const UNIT_SCALE: Record<Exclude<ModelUnit, "auto">, number> = { m: 1, cm: 0.01, mm: 0.001, ft: 0.3048, in: 0.0254 };

export interface ConvertOptions {
  unit: ModelUnit;
  /** Rotate a Z-up model (common in CAD/OBJ exports) to Y-up. */
  zUp: boolean;
  onProgress?: (text: string) => void;
}

export interface ConvertResult {
  glb: Blob;
  /** Size of the normalised model in metres: [width, height, depth]. */
  size: [number, number, number];
  /** Unit that was applied, after "auto" detection. */
  unit: Exclude<ModelUnit, "auto">;
}

const extensionOf = (name: string) => name.slice(name.lastIndexOf(".")).toLowerCase();
const baseName = (url: string) => decodeURIComponent(url.split("?")[0].split(/[\\/]/).pop() ?? "").toLowerCase();

/** Resolves companion files (.mtl, .bin, textures) referenced by name from blob: URLs. */
function companionManager(companions: File[]) {
  const urls = new Map<string, string>();
  for (const f of companions) urls.set(f.name.toLowerCase(), URL.createObjectURL(f));
  const manager = new LoadingManager();
  manager.setURLModifier((url) => urls.get(baseName(url)) ?? url);
  return { manager, urls, dispose: () => urls.forEach((u) => URL.revokeObjectURL(u)) };
}

async function loadIfc(file: File, onProgress?: (text: string) => void): Promise<Object3D> {
  const { IfcAPI } = await import("web-ifc");
  const api = new IfcAPI();
  await api.Init(() => webIfcWasmUrl, true);
  const modelID = api.OpenModel(new Uint8Array(await file.arrayBuffer()), { COORDINATE_TO_ORIGIN: true });

  // Group triangles by colour and merge them: an IFC has thousands of small
  // elements, one mesh per element would make a heavy GLB.
  const byColor = new Map<string, { color: [number, number, number, number]; parts: BufferGeometry[] }>();
  const matrix = new Matrix4();
  api.StreamAllMeshes(modelID, (flat, index, total) => {
    if (index % 200 === 0) onProgress?.(`Membaca elemen IFC ${index.toLocaleString("id-ID")} / ${total.toLocaleString("id-ID")}…`);
    for (let i = 0; i < flat.geometries.size(); i++) {
      const placed = flat.geometries.get(i);
      const geom = api.GetGeometry(modelID, placed.geometryExpressID);
      const verts = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
      const idx = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
      geom.delete();
      if (!idx.length) continue;
      // Interleaved x, y, z, nx, ny, nz.
      const n = verts.length / 6;
      const pos = new Float32Array(n * 3);
      const nor = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) {
        pos.set(verts.subarray(v * 6, v * 6 + 3), v * 3);
        nor.set(verts.subarray(v * 6 + 3, v * 6 + 6), v * 3);
      }
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(pos, 3));
      g.setAttribute("normal", new BufferAttribute(nor, 3));
      g.setIndex(new BufferAttribute(new Uint32Array(idx), 1));
      g.applyMatrix4(matrix.fromArray(placed.flatTransformation));
      const { x, y, z, w } = placed.color;
      const key = [x, y, z, w].map((c) => c.toFixed(3)).join(",");
      let bucket = byColor.get(key);
      if (!bucket) byColor.set(key, (bucket = { color: [x, y, z, w], parts: [] }));
      bucket.parts.push(g);
    }
  });
  api.CloseModel(modelID);

  onProgress?.("Menggabungkan geometri IFC…");
  const group = new Group();
  for (const { color, parts } of byColor.values()) {
    const merged = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    if (!merged) continue;
    const material = new MeshStandardMaterial({
      color: (Math.round(color[0] * 255) << 16) | (Math.round(color[1] * 255) << 8) | Math.round(color[2] * 255),
      opacity: color[3],
      transparent: color[3] < 1,
      side: DoubleSide,
      metalness: 0,
      roughness: 0.8,
    });
    group.add(new Mesh(merged, material));
  }
  if (!group.children.length) throw new Error("Tidak ada geometri yang dapat dibaca dari IFC ini.");
  return group;
}

async function loadWithThree(file: File, companions: File[]): Promise<Object3D> {
  const ext = extensionOf(file.name);
  const { manager, urls, dispose } = companionManager(companions);
  const url = URL.createObjectURL(file);
  try {
    switch (ext) {
      case ".obj": {
        const loader = new OBJLoader(manager);
        const mtl = companions.find((f) => extensionOf(f.name) === ".mtl");
        if (mtl) {
          const materials = await new MTLLoader(manager).loadAsync(urls.get(mtl.name.toLowerCase())!);
          materials.preload();
          loader.setMaterials(materials);
        }
        return await loader.loadAsync(url);
      }
      case ".fbx":
        return await new FBXLoader(manager).loadAsync(url);
      case ".dae": {
        const collada = await new ColladaLoader(manager).loadAsync(url);
        if (!collada) throw new Error("Berkas DAE tidak dapat dibaca.");
        return collada.scene;
      }
      case ".usdz":
      case ".usd":
      case ".usda":
      case ".usdc": {
        // Parsed from memory: USDLoader picks the parser from the URL's extension and a blob: URL has none.
        const data = ext === ".usda" ? await file.text() : await file.arrayBuffer();
        return await new Promise<Object3D>((resolve, reject) => new USDLoader(manager).parse(data, "", resolve, reject));
      }
      case ".gltf":
      case ".glb":
        return (await new GLTFLoader(manager).loadAsync(url)).scene;
      default:
        throw new Error(`Format ${ext} tidak didukung.`);
    }
  } finally {
    URL.revokeObjectURL(url);
    // Textures are decoded into images by now; GLTFExporter reads them from memory.
    await new Promise((r) => setTimeout(r, 0));
    dispose();
  }
}

/** Pick a unit so the model ends up a plausible size in metres. */
function detectUnit(maxDim: number, ext: string): Exclude<ModelUnit, "auto"> {
  if (ext === ".ifc" || ext === ".dae") return "m"; // both carry their unit; loaders already convert
  if (maxDim > 20000) return "mm";
  if (maxDim > 1500) return "cm";
  return "m";
}

/** Convert `main` (with optional companion files) to a placement-ready GLB. */
export async function convertToGlb(main: File, companions: File[], opts: ConvertOptions): Promise<ConvertResult> {
  const ext = extensionOf(main.name);
  opts.onProgress?.(`Mengonversi ${main.name} di browser…`);
  const object = ext === ".ifc" ? await loadIfc(main, opts.onProgress) : await loadWithThree(main, companions);

  const root = new Group();
  root.add(object);
  if (opts.zUp) object.rotation.x = -Math.PI / 2;
  root.updateMatrixWorld(true);

  const box = new Box3().setFromObject(root);
  if (box.isEmpty()) throw new Error("Model kosong (tidak ada geometri).");
  const raw = box.getSize(new Vector3());
  const unit = opts.unit === "auto" ? detectUnit(Math.max(raw.x, raw.y, raw.z), ext) : opts.unit;
  const scale = UNIT_SCALE[unit];

  // Origin at the centre of the base, so the click point is where the model stands.
  const centre = box.getCenter(new Vector3());
  object.position.sub(new Vector3(centre.x, box.min.y, centre.z));
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);

  opts.onProgress?.("Menyusun GLB…");
  const data = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true, animations: [] });
  const glb = new Blob([data as ArrayBuffer], { type: "model/gltf-binary" });
  return { glb, size: [raw.x * scale, raw.y * scale, raw.z * scale], unit };
}
