type Props<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], "style" | "children">> & {
  class?: string;
  style?: string;
  attrs?: Record<string, string>;
};

/** Tiny element factory: h("calcite-button", { kind: "brand" }, "Play"). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props<K> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: cls, style, attrs, ...rest } = props;
  if (cls) node.className = cls;
  if (style) node.setAttribute("style", style);
  for (const [k, v] of Object.entries(attrs ?? {})) node.setAttribute(k, v);
  Object.assign(node, rest);
  for (const child of children) if (child != null && child !== false) node.append(child);
  return node;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
