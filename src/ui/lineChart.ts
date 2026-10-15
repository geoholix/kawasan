import { formatDateTime, formatShortDate, formatTime } from "../core/time";

export interface ChartThreshold {
  value: number;
  label: string;
  color: string;
}

export interface LineChartData {
  times: number[];
  values: (number | null)[];
  currentIndex: number;
  /** Values after this time are drawn dashed (forecast). */
  nowTime: number | null;
  unit: string;
  label: string;
  thresholds?: ChartThreshold[];
  format?: (v: number) => string;
}

const NS = "http://www.w3.org/2000/svg";
const M = { top: 10, right: 12, bottom: 22, left: 36 };

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)!;
}

/**
 * Lightweight single-series time chart (SVG). One y-axis, recessive grid,
 * category threshold guides, dashed forecast segment, current-time marker,
 * and a crosshair tooltip. Clicking selects a time step.
 */
export function createLineChart(host: HTMLElement, onSelect: (index: number) => void, height = 150) {
  host.classList.add("chart");
  const svg = el("svg", { height, role: "img" });
  const tooltip = document.createElement("div");
  tooltip.className = "chart__tooltip";
  tooltip.hidden = true;
  host.append(svg, tooltip);

  let data: LineChartData | null = null;
  let width = 300;
  let x = (_i: number) => 0;
  let y = (_v: number) => 0;

  const draw = () => {
    svg.replaceChildren();
    width = Math.max(200, host.clientWidth);
    svg.setAttribute("width", String(width));
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    if (!data || !data.times.length) return;
    const d = data;
    svg.setAttribute("aria-label", `${d.label}, ${d.times.length} jam`);
    const fmt = d.format ?? ((v: number) => (Math.abs(v) >= 100 ? Math.round(v).toString() : v.toFixed(1)));

    const valid = d.values.filter((v): v is number => v != null);
    const dataMax = valid.length ? Math.max(...valid) : 1;
    const ymax = niceMax(dataMax * 1.1);
    const n = d.times.length;
    const iw = width - M.left - M.right;
    const ih = height - M.top - M.bottom;
    x = (i: number) => M.left + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
    y = (v: number) => M.top + ih - (v / ymax) * ih;

    // Grid + y labels
    for (let k = 0; k <= 4; k++) {
      const v = (ymax / 4) * k;
      svg.append(el("line", { x1: M.left, x2: width - M.right, y1: y(v), y2: y(v), class: "chart__grid" }));
      const t = el("text", { x: M.left - 6, y: y(v) + 3, class: "chart__axis", "text-anchor": "end" });
      t.textContent = fmt(v);
      svg.append(t);
    }
    // X labels: one per day at local midnight, or a few evenly spaced
    const ticks = Math.min(6, n);
    for (let k = 0; k < ticks; k++) {
      const i = Math.round((k / Math.max(1, ticks - 1)) * (n - 1));
      const t = el("text", { x: x(i), y: height - 6, class: "chart__axis", "text-anchor": k === 0 ? "start" : k === ticks - 1 ? "end" : "middle" });
      t.textContent = n > 48 ? formatShortDate(d.times[i]) : formatTime(d.times[i]);
      svg.append(t);
    }

    // Category thresholds within range
    for (const th of d.thresholds ?? []) {
      if (th.value > ymax) continue;
      svg.append(el("line", { x1: M.left, x2: width - M.right, y1: y(th.value), y2: y(th.value), class: "chart__threshold", stroke: th.color }));
      const label = el("text", { x: width - M.right - 2, y: y(th.value) - 3, class: "chart__axis", "text-anchor": "end" });
      label.textContent = th.label;
      svg.append(label);
    }

    // Forecast shading
    const nowIdx = d.nowTime == null ? -1 : d.times.findIndex((t) => t > d.nowTime!);
    if (nowIdx > 0) {
      svg.append(el("rect", { x: x(nowIdx - 1), y: M.top, width: width - M.right - x(nowIdx - 1), height: ih, class: "chart__forecast" }));
      const lbl = el("text", { x: x(nowIdx - 1) + 4, y: M.top + 10, class: "chart__axis" });
      lbl.textContent = "prakiraan";
      svg.append(lbl);
    }

    // Line(s): solid up to now, dashed after
    const path = (from: number, to: number) => {
      let dStr = "";
      let pen = false;
      for (let i = from; i <= to; i++) {
        const v = d.values[i];
        if (v == null) {
          pen = false;
          continue;
        }
        dStr += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      }
      return dStr;
    };
    const split = nowIdx > 0 ? nowIdx - 1 : nowIdx === 0 ? 0 : n - 1;
    if (nowIdx !== 0) svg.append(el("path", { d: path(0, split), class: "chart__line" }));
    if (nowIdx >= 0) svg.append(el("path", { d: path(split, n - 1), class: "chart__line chart__line--forecast" }));

    // Current time marker
    const ci = Math.min(Math.max(d.currentIndex, 0), n - 1);
    svg.append(el("line", { x1: x(ci), x2: x(ci), y1: M.top, y2: M.top + ih, class: "chart__cursor" }));
    const cv = d.values[ci];
    if (cv != null) svg.append(el("circle", { cx: x(ci), cy: y(cv), r: 4, class: "chart__dot" }));

    // Hover layer
    const hoverLine = el("line", { y1: M.top, y2: M.top + ih, class: "chart__hover", visibility: "hidden" });
    const hoverDot = el("circle", { r: 4, class: "chart__dot chart__dot--hover", visibility: "hidden" });
    const hit = el("rect", { x: M.left, y: 0, width: iw, height, fill: "transparent", style: "cursor: crosshair" });
    svg.append(hoverLine, hoverDot, hit);

    const indexAt = (clientX: number) => {
      const rect = svg.getBoundingClientRect();
      const px = clientX - rect.left;
      return Math.min(n - 1, Math.max(0, Math.round(((px - M.left) / iw) * (n - 1))));
    };
    hit.addEventListener("pointermove", (e) => {
      const i = indexAt(e.clientX);
      const v = d.values[i];
      hoverLine.setAttribute("x1", String(x(i)));
      hoverLine.setAttribute("x2", String(x(i)));
      hoverLine.setAttribute("visibility", "visible");
      if (v != null) {
        hoverDot.setAttribute("cx", String(x(i)));
        hoverDot.setAttribute("cy", String(y(v)));
        hoverDot.setAttribute("visibility", "visible");
      } else hoverDot.setAttribute("visibility", "hidden");
      tooltip.hidden = false;
      tooltip.innerHTML = `<span class="chart__tooltip-time">${formatDateTime(d.times[i])}</span><strong>${v == null ? "–" : fmt(v)}</strong> ${d.unit}`;
      const left = Math.min(width - tooltip.offsetWidth - 4, Math.max(4, x(i) + 10));
      tooltip.style.left = `${left}px`;
    });
    hit.addEventListener("pointerleave", () => {
      hoverLine.setAttribute("visibility", "hidden");
      hoverDot.setAttribute("visibility", "hidden");
      tooltip.hidden = true;
    });
    hit.addEventListener("click", (e) => onSelect(indexAt(e.clientX)));
  };

  new ResizeObserver(() => draw()).observe(host);

  return {
    update(next: LineChartData) {
      data = next;
      draw();
    },
  };
}
