import type ArcGISMap from "@arcgis/core/Map";
import type SceneView from "@arcgis/core/views/SceneView";
import type { AppConfig } from "../config/app.config";
import type { DataService } from "./dataService";
import type { Store } from "./store";
import type { AirQualityProvider, WeatherProvider } from "./types";
import type { Views } from "../views";

/** Valid Calcite icon name (https://developers.arcgis.com/calcite-design-system/icons/). */
export type IconName = NonNullable<HTMLElementTagNameMap["calcite-icon"]["icon"]>;

/** Everything a module may use. Passed to every layer and widget on creation. */
export interface AppContext {
  config: AppConfig;
  store: Store;
  data: DataService;
  view: SceneView;
  map: ArcGISMap;
  /** 3D/2D mode switching, the SCBD/PIK areas and the kawasan web map (see views.ts). */
  views: Views;
}

export interface LegendItem {
  label: string;
  color?: string;
  icon?: IconName;
}

/** A setting a layer exposes in the Layers widget (rendered generically). */
export interface LayerControl {
  type: "slider";
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange(value: number): void;
}

/**
 * A layer module owns one visual element in the scene (ArcGIS layers,
 * environment effects, ...). It reacts to store changes itself.
 */
export interface LayerModule {
  id: string;
  title: string;
  description?: string;
  visibleByDefault: boolean;
  legend?: LegendItem[];
  controls?: LayerControl[];
  init(ctx: AppContext): Promise<void> | void;
  setVisible(visible: boolean): void;
}

/** A widget module is a panel opened from the action bar. */
export interface WidgetModule {
  id: string;
  title: string;
  /** Calcite icon name, see https://developers.arcgis.com/calcite-design-system/icons/ */
  icon: IconName;
  /** Open this widget on start-up. Only one start panel widget is open at a time. */
  openByDefault?: boolean;
  placement: "start" | "end";
  create(ctx: AppContext): HTMLElement;
}

export interface ModuleRegistry {
  airQualityProviders: AirQualityProvider[];
  weatherProviders: WeatherProvider[];
  layers: LayerModule[];
  widgets: WidgetModule[];
}
