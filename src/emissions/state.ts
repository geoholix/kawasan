import { Store } from "../core/store";
import { BASELINE, estimate, type EmissionInventory, type EmissionResult, type Scenario } from "./model";

export interface EmissionState {
  inventory: EmissionInventory | null;
  scenario: Scenario;
  baseline: EmissionResult | null;
  result: EmissionResult | null;
  error: string | null;
}

/**
 * The emission feature keeps its own store so it stays a self-contained
 * module: the layer and widget share it, the core app does not know about it.
 */
export const emissionStore = new Store<EmissionState>({
  inventory: null,
  scenario: BASELINE,
  baseline: null,
  result: null,
  error: null,
});

emissionStore.on(["inventory", "scenario"], (s) => {
  if (!s.inventory) return;
  emissionStore.set({ baseline: estimate(s.inventory), result: estimate(s.inventory, s.scenario) });
});

let loading: Promise<void> | null = null;

/** Load the inventory once (both the layer and the widget call this). */
export function loadInventory(url: string): Promise<void> {
  loading ??= fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json() as Promise<EmissionInventory>;
    })
    .then((inventory) => emissionStore.set({ inventory, error: null }))
    .catch((err) => {
      console.error("Emission inventory failed to load", err);
      emissionStore.set({ error: `Inventaris emisi gagal dimuat: ${err instanceof Error ? err.message : String(err)}` });
    });
  return loading;
}
