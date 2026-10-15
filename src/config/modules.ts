/**
 * Module registry — the single place to add or remove data sources, layers
 * and widgets. Order matters for providers: earlier providers win when two
 * return a value for the same hour (see core/dataService.ts).
 */
import type { LayerModule, ModuleRegistry, WidgetModule } from "../core/modules";
import type { AirQualityProvider } from "../core/types";
import { appConfig } from "./app.config";
import { createAtmosphereLayers } from "../layers/atmosphereLayer";
import { createBuildingsLayer } from "../layers/buildingsLayer";
import { createSpaceTimeCubeLayer } from "../layers/spaceTimeCubeLayer";
import { createPollutionSurfaceLayer } from "../layers/pollutionSurfaceLayer";
import { createStationsLayer } from "../layers/stationsLayer";
import { createWindLayer } from "../layers/windLayer";
import { createTreesLayer } from "../greening/treesLayer";
import { createTreesWidget } from "../greening/treesWidget";
import { createFlowLayer } from "../wind/flowLayer";
import { windWidget } from "../wind/windWidget";
import { bookmarksWidget } from "../widgets/bookmarksWidget";
import { addDataWidget } from "../adddata/addDataWidget";
import { createModelImportLayer } from "../adddata/modelImport";
import { createEmissionWidget } from "../emissions/emissionWidget";
import { createEmissionsLayer } from "../emissions/emissionsLayer";
import { mockAirQuality } from "../providers/airquality/mockAirQuality";
import { createArchiveProvider } from "../providers/airquality/archiveProvider";
import { openMeteoAirQuality } from "../providers/airquality/openMeteoAirQuality";
import { createUdaraJakartaProvider } from "../providers/airquality/udaraJakarta";
import { bmkgForecast } from "../providers/weather/bmkg";
import { mockWeather } from "../providers/weather/mockWeather";
import { openMeteoWeather } from "../providers/weather/openMeteoWeather";
import { createAboutWidget } from "../widgets/aboutWidget";
import { chartWidget } from "../widgets/chartWidget";
import { createLayersWidget } from "../widgets/layersWidget";
import { trendWidget } from "../widgets/trendWidget";
import { summaryWidget } from "../widgets/summaryWidget";
import { weatherWidget } from "../widgets/weatherWidget";
import { assistantWidget } from "../assistant";

const udaraJakarta = createUdaraJakartaProvider(import.meta.env.VITE_UDARA_JAKARTA_URL);

export function createRegistry(): ModuleRegistry {
  const airQualityProviders: AirQualityProvider[] = [
    ...(udaraJakarta ? [udaraJakarta] : []), // station measurements first
    createArchiveProvider(appConfig.archiveUrl), // scheduled snapshots committed to the repo
    openMeteoAirQuality, // model: fills gaps and provides the forecast
    mockAirQuality, // synthetic fallback, only if everything above fails
  ];

  const weatherProviders = [
    bmkgForecast, // official forecast for the next 3 days
    openMeteoWeather, // history + beyond BMKG's window
    mockWeather,
  ];

  const layers: LayerModule[] = [
    createBuildingsLayer(),
    createPollutionSurfaceLayer(),
    createStationsLayer(),
    createFlowLayer(),
    createWindLayer(),
    createTreesLayer(appConfig.treeSpeciesUrl),
    createModelImportLayer(),
    createSpaceTimeCubeLayer(),
    createEmissionsLayer(appConfig.emissionInventoryUrl),
    ...createAtmosphereLayers(),
  ];

  const registry: ModuleRegistry = { airQualityProviders, weatherProviders, layers, widgets: [] };
  const widgets: WidgetModule[] = [
    bookmarksWidget,
    assistantWidget,
    addDataWidget,
    chartWidget,
    weatherWidget,
    windWidget,
    createTreesWidget(appConfig.treeSpeciesUrl),
    trendWidget,
    createEmissionWidget(appConfig.emissionInventoryUrl),
    createLayersWidget(layers),
    createAboutWidget(registry),
    summaryWidget,
  ];
  registry.widgets = widgets;
  return registry;
}
