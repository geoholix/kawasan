import Bookmark from "@arcgis/core/webmap/Bookmark";
import type { WidgetModule } from "../core/modules";
import { h } from "../ui/dom";
import { areaBookmarks } from "../views";

// v2: defaults reduced to SCBD and PIK; older saved lists (with sensor bookmarks) are not restored.
const STORAGE_KEY = "kawasan:bookmarks:v2";

/** Default bookmarks: the two kawasan, SCBD and PIK. */
export const defaultBookmarks = (): Bookmark[] => areaBookmarks();

function loadSaved(): Bookmark[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as unknown[]).map((j) => Bookmark.fromJSON(j)) : null;
  } catch {
    return null;
  }
}

function save(bookmarks: Bookmark[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks.map((b) => b.toJSON())));
  } catch {
    // Quota exceeded (large thumbnails) or storage unavailable: keep without thumbnails.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks.map((b) => ({ ...b.toJSON(), thumbnail: undefined }))));
    } catch {
      /* storage unavailable */
    }
  }
}

/** Bookmarks (arcgis-bookmarks): SCBD and PIK by default, user bookmarks saved in the browser. */
export const bookmarksWidget: WidgetModule = {
  id: "bookmarks",
  title: "Bookmark",
  icon: "bookmark",
  placement: "start",
  openByDefault: true,

  create({ views }) {
    const el = document.createElement("arcgis-bookmarks");
    // Follow the 3D/2D toggle: bookmarks act on whichever view is shown.
    const bind = () => {
      el.view = (document.getElementById(views.mode === "3d" ? "scene" : "map") as HTMLArcgisSceneElement).view;
    };
    bind();
    views.onModeChange(bind);
    el.showAddBookmarkButton = true;
    el.showEditBookmarkButton = true;
    el.showFilter = true;
    el.dragEnabled = true;
    el.timeDisabled = true;
    el.showHeading = false;
    el.bookmarks = loadSaved() ?? defaultBookmarks();

    // Persist any change (add, edit, delete, reorder) made in the widget.
    let watching = el.bookmarks;
    const persist = () => save(el.bookmarks.toArray());
    let handle = watching.on("change", persist);
    el.addEventListener("arcgisBookmarkEdit", persist);

    const reset = h("calcite-button", { iconStart: "reset", scale: "s", appearance: "transparent", width: "full" }, "Pulihkan bookmark bawaan");
    reset.addEventListener("click", () => {
      handle.remove();
      localStorage.removeItem(STORAGE_KEY);
      el.bookmarks = defaultBookmarks();
      watching = el.bookmarks;
      handle = watching.on("change", persist);
    });

    return h(
      "div",
      { class: "widget widget--flush" },
      el,
      h(
        "div",
        { class: "widget-section" },
        h("p", { class: "muted small" }, "Bawaan: kawasan SCBD dan PIK. Tambah bookmark dari tampilan saat ini dengan tombol +; perubahan disimpan di browser ini."),
        reset,
      ),
    );
  },
};
