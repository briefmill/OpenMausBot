import { useEffect, useState } from "react";
import { api } from "@/state/store";
import type { Point } from "./team-canvas";

export type MapLayout = { positions: Record<string, Point>; botOrders: Record<string, string[]>; showScreens?: boolean };
let layout: MapLayout | null = null;
let generation = 0;
let pending = 0;
let writing = Promise.resolve();
const listeners = new Set<() => void>();
const publish = (next: MapLayout) => { layout = next; for (const listener of listeners) listener(); };
async function refresh() {
  if (pending) return;
  const before = generation;
  try {
    const response = await api("/api/team-map/layout");
    if (!pending && before === generation && response.layout) publish(response.layout);
  } catch {}
}
export function saveMapLayout(patch: Partial<MapLayout>, initialize = false) {
  const revision = ++generation;
  pending++;
  if (!initialize) publish({ positions: { ...layout?.positions, ...patch.positions }, botOrders: { ...layout?.botOrders, ...patch.botOrders }, ...(layout?.showScreens === undefined ? {} : { showScreens: layout.showScreens }), ...(patch.showScreens === undefined ? {} : { showScreens: patch.showScreens }) });
  writing = writing.catch(() => {}).then(async () => {
    const response = await api("/api/team-map/layout", { method: "PATCH", body: JSON.stringify({ ...patch, ...(initialize ? { initialize: true } : {}) }) });
    if (generation === revision && response.layout) publish(response.layout);
  }).catch(() => {}).finally(() => { pending--; });
}
export function useSyncedMapLayout() {
  const [value, setValue] = useState(layout);
  useEffect(() => {
    const changed = () => setValue(layout);
    listeners.add(changed);
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    return () => { listeners.delete(changed); window.clearInterval(timer); };
  }, []);
  return value;
}
