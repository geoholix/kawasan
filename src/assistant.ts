import "@arcgis/ai-components/components/arcgis-assistant";
import "@arcgis/ai-components/components/arcgis-assistant-navigation-agent";
import "@arcgis/ai-components/components/arcgis-assistant-data-exploration-agent";
import "@arcgis/ai-components/components/arcgis-assistant-help-agent";
import { config } from "./config";
import type { WidgetModule } from "./core/modules";
import type { Views } from "./views";

/** Action-bar panel for the AI assistant (registered in config/modules.ts). */
export const assistantWidget: WidgetModule = {
  id: "assistant",
  title: "Asisten AI",
  icon: "speech-bubble",
  placement: "start",
  create: ({ views }) => assistantPanel(views),
};

/**
 * ArcGIS AI components (beta). The assistant and its agents only support a 2D arcgis-map, so they work
 * on #map; in 3D mode views.beginAssistantTurn()/endAssistantTurn() hand the location over and back.
 */
export function assistantPanel(views: Views): HTMLElement {
  // The assistant reads the web map's portal/sign-in state when it starts, so it is created only after
  // the web map has loaded (the 2D map is a placeholder until then).
  const host = document.createElement("div");
  const wait = document.createElement("p");
  wait.className = "muted small widget";
  wait.textContent = "Asisten AI aktif setelah web map dimuat. Jika belum masuk, klik \"Masuk ArcGIS\" di bagian atas.";
  host.append(wait);
  views.onWebmapLoaded(() => host.replaceChildren(createAssistant(views)));
  return host;
}

function createAssistant(views: Views): HTMLElement {
  const assistant = document.createElement("arcgis-assistant");
  assistant.referenceElement = document.getElementById("map") as HTMLArcgisMapElement;
  // Texts are configurable in config.json ("assistant").
  const texts = config.assistant;
  assistant.heading = texts.heading;
  assistant.description = texts.description;
  assistant.entryMessage = texts.entryMessage;
  assistant.copyEnabled = true;
  assistant.suggestedPrompts = texts.suggestedPrompts;

  // Log action in the chat: shows which agents/tools were invoked and with what parameters ("thinking").
  assistant.logEnabled = true;

  // In-progress state: spinner + "Berpikir…" + the step the assistant is on (awaitingResponseStep).
  const loading = document.createElement("div");
  loading.slot = "message-loading";
  loading.className = "thinking";
  const loader = document.createElement("calcite-loader");
  loader.scale = "s";
  loader.inline = true;
  loader.label = "Memproses";
  const label = document.createElement("span");
  label.className = "thinking__label";
  const step = document.createElement("span");
  step.className = "thinking__step";
  loading.append(loader, label, step);
  // The slotted element stays rendered between responses, so it is shown only while a response is pending.
  loading.hidden = true;
  assistant.append(loading);

  const refreshStep = () => {
    label.textContent = "Berpikir…";
    step.textContent = assistant.awaitingResponseStep ? ` ${assistant.awaitingResponseStep}` : "";
  };
  // awaitingResponseStep has no change event: poll only while a response is pending.
  let timer: number | undefined;
  const stop = () => {
    window.clearInterval(timer);
    timer = undefined;
    loading.hidden = true;
  };
  assistant.addEventListener("arcgisSubmit", () => {
    loading.hidden = false;
    refreshStep();
    stop();
    timer = window.setInterval(() => (assistant.awaitingResponse ? refreshStep() : stop()), 300);
  });
  for (const ev of ["arcgisResponse", "arcgisError", "arcgisCancel"]) assistant.addEventListener(ev, stop);

  assistant.append(
    document.createElement("arcgis-assistant-navigation-agent"),
    document.createElement("arcgis-assistant-data-exploration-agent"),
    document.createElement("arcgis-assistant-help-agent"),
  );

  // Chat history: kept in this browser (localStorage), restored on load, newest HISTORY_LIMIT messages.
  const HISTORY_KEY = "kawasan:assistant-history";
  const HISTORY_LIMIT = 40;
  const saveHistory = () => {
    try {
      const done = assistant.messages.toArray().filter((m) => !(m.role === "assistant" && m.isStreaming));
      // Never overwrite saved history with an empty list (the assistant clears messages while starting up);
      // the trash action removes the key explicitly.
      if (!done.length) return;
      const plain = done.slice(-HISTORY_LIMIT).map((m) => JSON.parse(JSON.stringify(m)));
      localStorage.setItem(HISTORY_KEY, JSON.stringify(plain));
    } catch {
      /* storage full or unavailable */
    }
  };
  // The assistant resets its messages while initialising, so restore only once it reports ready.
  assistant.addEventListener(
    "arcgisReady",
    () => {
      try {
        const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as { id: string; role: string }[];
        const valid = saved.filter((m) => m && typeof m.id === "string" && (m.role === "user" || m.role === "assistant"));
        if (valid.length && !assistant.messages.length) assistant.messages.addMany(valid as never[]);
      } catch {
        localStorage.removeItem(HISTORY_KEY);
      }
      assistant.messages.on("change", saveHistory);
    },
    { once: true },
  );
  assistant.addEventListener("arcgisResponse", saveHistory);

  const clear = document.createElement("calcite-action");
  clear.slot = "header-actions-end";
  clear.icon = "trash";
  clear.text = "Hapus riwayat";
  clear.scale = "s";
  clear.addEventListener("click", async () => {
    await assistant.clearChatHistory();
    localStorage.removeItem(HISTORY_KEY);
  });
  assistant.append(clear);

  assistant.addEventListener("arcgisSubmit", () => views.beginAssistantTurn());
  assistant.addEventListener("arcgisResponse", () => views.endAssistantTurn());
  assistant.addEventListener("arcgisError", (e) => console.error("Asisten AI", (e as CustomEvent).detail));
  return assistant;
}
