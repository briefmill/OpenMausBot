import { useSyncExternalStore } from "react";
import { api } from "../state/api";
import { parseWebPanels, type WebPanel, type WebPanelsSnapshot } from "./web-panels";
import { createWebPanelSync } from "./web-panel-sync";

export const WEB_PANELS_KEY = "omb-web-panels";
const listeners = new Set<() => void>();
const NONE: WebPanel[] = [];
const notify = () => { for (const listener of listeners) listener(); };
function legacyPanels(): WebPanel[] {
  try { return parseWebPanels(globalThis.localStorage?.getItem(WEB_PANELS_KEY)); }
  catch { return []; }
}
const sync = createWebPanelSync(async (snapshot?: WebPanelsSnapshot) => {
  const answer = await api<WebPanelsSnapshot>("/api/workspace/navigation", snapshot
    ? { method: "PUT", body: JSON.stringify(snapshot), timeoutMs: 10_000 }
    : { background: true, timeoutMs: 10_000 });
  return answer;
}, legacyPanels(), notify);

function refresh() {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  void sync.refresh();
}
let timer: ReturnType<typeof setInterval> | undefined;
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    timer = setInterval(refresh, 5_000);
    refresh();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && typeof window !== "undefined") {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(timer);
      timer = undefined;
    }
  };
}

export function setWebPanels(panels: readonly WebPanel[]): void { sync.set(panels); }
export function latestWebPanels(): readonly WebPanel[] { return sync.panels(); }
export function useWebPanels(): WebPanel[] { return useSyncExternalStore(subscribe, sync.panels, () => NONE); }
export function useWebPanelsSyncStatus() { return useSyncExternalStore(subscribe, sync.status, () => "loading" as const); }
