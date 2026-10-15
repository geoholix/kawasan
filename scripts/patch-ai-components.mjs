// Patches @arcgis/ai-components 5.1.x (beta): some agents turn the LLM reply into text with
// `content.toString()` / `String(content)`. When the model returns structured content parts
// (an array of { type: "text", text }) the user sees "[object Object]" instead of the answer.
// This replaces those calls with a helper that joins the text parts. Runs on `npm install`
// (postinstall); safe to run repeatedly. Fails if the expected code is not found, so an
// upgraded package that changed (or fixed) this is noticed instead of silently skipped.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const chunks = join(root, "node_modules/@arcgis/ai-components/dist/chunks");
const MARKER = "__kwText";
const HELPER =
  `const ${MARKER} = (c) => typeof c === "string" ? c : Array.isArray(c) ? ` +
  `c.map((p) => typeof p === "string" ? p : p && typeof p.text === "string" ? p.text : "").join("") : ` +
  `c == null ? "" : typeof c.text === "string" ? c.text : String(c);\n`;

const patches = {
  "dataExplorationGraph.js": [
    ["o.content.toString()", `${MARKER}(o.content)`],
    ["y.content.toString()", `${MARKER}(y.content)`],
  ],
  "arcgisKnowledgeGraph.js": [["r.content.toString()", `${MARKER}(r.content)`]],
  "toolCallResponse.js": [["String(t?.content)", `${MARKER}(t?.content)`]],
};

if (!existsSync(chunks)) {
  console.log("[patch-ai-components] @arcgis/ai-components not installed, skipping");
  process.exit(0);
}

let changed = false;
for (const [file, replacements] of Object.entries(patches)) {
  const path = join(chunks, file);
  let src = readFileSync(path, "utf8");
  if (src.includes(MARKER)) continue;
  for (const [from, to] of replacements) {
    if (!src.includes(from)) {
      console.error(`[patch-ai-components] "${from}" not found in ${file}; check whether the package changed.`);
      process.exit(1);
    }
    src = src.split(from).join(to);
  }
  // Insert the helper after the leading copyright comment.
  const firstNewline = src.indexOf("\n") + 1;
  src = src.slice(0, firstNewline) + HELPER + src.slice(firstNewline);
  writeFileSync(path, src);
  changed = true;
  console.log(`[patch-ai-components] patched ${file}`);
}

// Vite pre-bundles dependencies; drop its cache so the patched files are used.
if (changed) rmSync(join(root, "node_modules/.vite"), { recursive: true, force: true });
