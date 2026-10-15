import type { AppContext } from "../core/modules";
import { DAY, floorHour, formatDateTime, isoDate, nearestIndex, parseIsoDate } from "../core/time";
import { h } from "./dom";

const SPEEDS = [1, 2, 4, 8, 16];
const MODE_LABEL = { historical: "Historis", realtime: "Real-time", forecast: "Forecast" };

/** Bottom dock: play/pause, step, slider, speed, date range (historical) and live button (real-time). */
export function mountTimelineDock(ctx: AppContext, host: HTMLElement): void {
  const { store, data, config } = ctx;

  const back = h("calcite-action", { icon: "chevron-left", text: "Jam sebelumnya", scale: "m" });
  const play = h("calcite-button", { iconStart: "play-f", kind: "brand", round: true, scale: "l", label: "Putar" });
  const fwd = h("calcite-action", { icon: "chevron-right", text: "Jam berikutnya", scale: "m" });

  const timeLabel = h("div", { class: "dock__time" });
  const modeLabel = h("div", { class: "dock__mode" });
  const slider = h("calcite-slider", { min: 0, max: 1, step: 1, value: 0, labelHandles: false, scale: "m", class: "dock__slider", attrs: { "aria-label": "Waktu" } });

  const speed = h("calcite-select", { scale: "s", label: "Kecepatan", class: "dock__speed" });
  for (const v of SPEEDS) speed.append(h("calcite-option", { value: String(v), selected: v === store.state.speed }, `${v}× jam/detik`));

  const today = isoDate(Date.now());
  const range = h("calcite-input-date-picker", {
    range: true,
    scale: "s",
    max: today,
    min: "2022-08-01",
    lang: "id",
    overlayPositioning: "fixed",
    class: "dock__range",
  });
  const live = h("calcite-button", { iconStart: "clock", kind: "inverse", scale: "s", appearance: "outline" }, "Live");
  const loader = h("calcite-loader", { inline: true, label: "Memuat data", hidden: true });
  const refresh = h("calcite-action", { icon: "refresh", text: "Muat ulang data", scale: "s" });

  host.append(
    h(
      "div",
      { class: "dock" },
      h("div", { class: "dock__controls" }, back, play, fwd),
      h("div", { class: "dock__main" }, h("div", { class: "dock__heading" }, modeLabel, timeLabel, loader), slider),
      h("div", { class: "dock__options" }, range, live, speed, refresh),
    ),
  );

  const count = () => store.state.airQuality?.times.length ?? 0;
  const go = (i: number) => store.set({ timeIndex: Math.max(0, Math.min(count() - 1, i)), followLive: false });

  back.addEventListener("click", () => go(store.state.timeIndex - 1));
  fwd.addEventListener("click", () => go(store.state.timeIndex + 1));
  play.addEventListener("click", () => {
    const s = store.state;
    // Restart from the beginning when play is pressed at the end.
    if (!s.playing && s.timeIndex >= count() - 1) store.set({ timeIndex: 0 });
    store.set({ playing: !s.playing });
  });
  slider.addEventListener("calciteSliderInput", () => go(Number(slider.value)));
  speed.addEventListener("calciteSelectChange", () => store.set({ speed: Number(speed.value) }));
  refresh.addEventListener("click", () => void data.load());
  live.addEventListener("click", () => {
    const times = store.state.airQuality?.times ?? [];
    store.set({ timeIndex: nearestIndex(times, floorHour(Date.now())), followLive: true, playing: false });
  });
  range.addEventListener("calciteInputDatePickerChange", () => {
    const [start, end] = (range.value as string[]) ?? [];
    if (!start || !end) return;
    let s = parseIsoDate(start);
    let e = Math.min(parseIsoDate(end) + DAY - 1, floorHour(Date.now()));
    if (e - s > config.maxHistoricalDays * DAY) s = e - config.maxHistoricalDays * DAY;
    if (e <= s) e = s + DAY - 1;
    data.setRange({ start: s, end: e });
  });

  store.on(
    ["airQuality"],
    (s) => {
      slider.max = Math.max(1, count() - 1);
      slider.disabled = count() < 2;
      const times = s.airQuality?.times ?? [];
      if (s.mode === "historical" && times.length) range.value = [isoDate(times[0]), isoDate(times[times.length - 1])];
    },
    true,
  );
  store.on(
    ["timeIndex", "airQuality", "followLive", "mode"],
    (s) => {
      slider.value = s.timeIndex;
      const t = s.airQuality?.times[s.timeIndex];
      timeLabel.textContent = t != null ? formatDateTime(t) : "–";
      const now = floorHour(Date.now());
      const tag = t == null ? "" : t > now ? "prakiraan" : t === now ? "saat ini" : "historis";
      modeLabel.textContent = tag && tag !== MODE_LABEL[s.mode].toLowerCase() ? `${MODE_LABEL[s.mode]} · ${tag}` : MODE_LABEL[s.mode];
      live.appearance = s.followLive ? "solid" : "outline";
    },
    true,
  );
  store.on(
    ["playing"],
    (s) => {
      play.iconStart = s.playing ? "pause-f" : "play-f";
      play.label = s.playing ? "Jeda" : "Putar";
    },
    true,
  );
  store.on(["loading"], (s) => (loader.hidden = !s.loading), true);
  store.on(
    ["mode"],
    (s) => {
      range.hidden = s.mode !== "historical";
      live.hidden = s.mode !== "realtime";
    },
    true,
  );
}
