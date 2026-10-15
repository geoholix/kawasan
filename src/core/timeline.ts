import type { Store } from "./store";

/** Drives timeIndex while `playing` is true. Frame-rate independent. */
export function startTimelinePlayer(store: Store): void {
  let raf = 0;
  let last = 0;
  let acc = 0;

  const tick = (now: number) => {
    const s = store.state;
    const count = s.airQuality?.times.length ?? 0;
    if (!s.playing || count < 2) return;
    acc += ((now - last) / 1000) * s.speed;
    last = now;
    if (acc >= 1) {
      const steps = Math.floor(acc);
      acc -= steps;
      let next = s.timeIndex + steps;
      if (next >= count) {
        if (s.mode === "realtime") {
          store.set({ timeIndex: count - 1, playing: false, followLive: true });
          return;
        }
        next = 0;
      }
      store.set({ timeIndex: next, followLive: false });
    }
    raf = requestAnimationFrame(tick);
  };

  store.on(["playing"], (s) => {
    cancelAnimationFrame(raf);
    if (s.playing) {
      last = performance.now();
      acc = 0;
      raf = requestAnimationFrame(tick);
    }
  });
}
