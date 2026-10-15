import type { AppConfig } from "../config/app.config";
import { fetchBmkgForecasts } from "../providers/weather/bmkg";
import { POLLUTANTS } from "./ispu";
import type { ModuleRegistry } from "./modules";
import type { Store } from "./store";
import { defaultRange, floorHour, hourlyAxis, nearestIndex } from "./time";
import type {
  AirQualityDataset,
  AirQualityProvider,
  PollutantSeries,
  ProviderRequest,
  TimeMode,
  TimeRange,
  WeatherDataset,
  WeatherProvider,
  WeatherSample,
} from "./types";

/**
 * Loads data for the current mode/range from every registered provider and
 * merges it slot by slot: providers earlier in the registry win, later ones
 * fill the gaps. Synthetic providers are used only if no real provider
 * returns anything, so real and fake values are never mixed.
 */
export class DataService {
  private controller: AbortController | null = null;
  private refreshTimer: number | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly store: Store,
    private readonly registry: ModuleRegistry,
  ) {
    store.on(["mode"], (s) => this.setRange(defaultRange(s.mode)));
    store.on(["range"], () => void this.load());
    store.on(["mode"], (s) => this.scheduleRefresh(s.mode), true);
  }

  setRange(range: TimeRange): void {
    this.store.set({ range });
  }

  async load(): Promise<void> {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const { range, mode } = this.store.state;
    const times = hourlyAxis(range);
    this.store.set({ loading: true, error: null, playing: false });

    try {
      const [airQuality, weather, bmkg] = await Promise.all([
        this.loadAirQuality({ times, range, locations: this.config.stations, signal: controller.signal }),
        this.loadWeather({ times, range, locations: this.config.weatherLocations, signal: controller.signal }),
        this.config.useMockData
          ? Promise.resolve([])
          : fetchBmkgForecasts(this.config.weatherLocations, controller.signal).catch(() => []),
      ]);
      if (controller.signal.aborted) return;

      const prev = this.store.state;
      const timeIndex = this.initialIndex(mode, times, prev.followLive, prev.airQuality?.times[prev.timeIndex]);
      this.store.set({ airQuality, weather, bmkg, timeIndex, loading: false, lastUpdated: Date.now() });
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error(err);
      this.store.set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private initialIndex(mode: TimeMode, times: number[], followLive: boolean, previousTime?: number): number {
    const now = floorHour(Date.now());
    if (mode === "realtime" && (followLive || previousTime == null)) return nearestIndex(times, now);
    if (previousTime != null && previousTime >= times[0] && previousTime <= times[times.length - 1]) {
      return nearestIndex(times, previousTime);
    }
    return mode === "historical" ? 0 : nearestIndex(times, now);
  }

  private scheduleRefresh(mode: TimeMode): void {
    if (this.refreshTimer != null) window.clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    if (mode !== "realtime") return;
    this.refreshTimer = window.setInterval(() => {
      // Slide the window forward so "now" stays at the end of the timeline.
      this.setRange(defaultRange("realtime"));
      if (this.store.state.range.end === floorHour(Date.now())) void this.load();
    }, this.config.realtimeRefreshMinutes * 60_000);
  }

  private async loadAirQuality(request: ProviderRequest<(typeof this.config.stations)[number]>): Promise<AirQualityDataset> {
    const providers = this.pick(this.registry.airQualityProviders);
    const empty = (): PollutantSeries => ({ pm2_5: [], pm10: [], no2: [], o3: [], so2: [], co: [] });
    const merged: Record<string, PollutantSeries> = {};
    for (const s of request.locations) {
      merged[s.id] = empty();
      for (const p of POLLUTANTS) merged[s.id][p] = request.times.map(() => null);
    }

    const run = async (list: AirQualityProvider[]) => {
      const sources: string[] = [];
      const results = await Promise.allSettled(list.map((p) => p.fetch(request)));
      results.forEach((r, i) => {
        if (r.status === "rejected") {
          if (!request.signal?.aborted) console.warn(`[${list[i].id}]`, r.reason);
          return;
        }
        let contributed = false;
        for (const [stationId, series] of Object.entries(r.value)) {
          const target = merged[stationId];
          if (!target) continue;
          for (const p of POLLUTANTS) {
            series[p]?.forEach((v, k) => {
              if (v != null && target[p][k] == null) {
                target[p][k] = v;
                contributed = true;
              }
            });
          }
        }
        if (contributed) sources.push(list[i].id);
      });
      return sources;
    };

    let sources = await run(providers.real);
    let synthetic = false;
    if (!sources.length && providers.synthetic.length) {
      sources = await run(providers.synthetic);
      synthetic = true;
    }
    return { times: request.times, stations: merged, sources, synthetic };
  }

  private async loadWeather(request: ProviderRequest<(typeof this.config.weatherLocations)[number]>): Promise<WeatherDataset> {
    const providers = this.pick(this.registry.weatherProviders);
    const merged: Record<string, (WeatherSample | null)[]> = {};
    for (const l of request.locations) merged[l.id] = request.times.map(() => null);

    const run = async (list: WeatherProvider[]) => {
      const sources: string[] = [];
      const results = await Promise.allSettled(list.map((p) => p.fetch(request)));
      results.forEach((r, i) => {
        if (r.status === "rejected") {
          if (!request.signal?.aborted) console.warn(`[${list[i].id}]`, r.reason);
          return;
        }
        let contributed = false;
        for (const [id, series] of Object.entries(r.value)) {
          const target = merged[id];
          if (!target) continue;
          series.forEach((v, k) => {
            if (v && !target[k]) {
              target[k] = v;
              contributed = true;
            }
          });
        }
        if (contributed) sources.push(list[i].id);
      });
      return sources;
    };

    let sources = await run(providers.real);
    let synthetic = false;
    if (!sources.length && providers.synthetic.length) {
      sources = await run(providers.synthetic);
      synthetic = true;
    }
    return { times: request.times, locations: merged, sources, synthetic };
  }

  private pick<T extends { synthetic?: boolean }>(list: T[]): { real: T[]; synthetic: T[] } {
    const synthetic = list.filter((p) => p.synthetic);
    return { real: this.config.useMockData ? [] : list.filter((p) => !p.synthetic), synthetic };
  }
}
