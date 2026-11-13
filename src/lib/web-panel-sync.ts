import { MAX_WEB_PANELS, parseWebPanels, type WebPanel, type WebPanelsSnapshot } from "./web-panels";

export type PanelsSyncStatus = "loading" | "synced" | "pending" | "error";
type Edit = { removed: string[]; changed: WebPanel[] };
type Request = (snapshot?: WebPanelsSnapshot) => Promise<WebPanelsSnapshot>;

function checked(value: WebPanelsSnapshot): WebPanelsSnapshot {
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.panels)
    || JSON.stringify(parseWebPanels(JSON.stringify(value.panels))) !== JSON.stringify(value.panels)) throw new Error("Invalid pinned navigation response");
  return value;
}

function apply(panels: readonly WebPanel[], edits: readonly Edit[]): WebPanel[] {
  let next = [...panels];
  for (const edit of edits) {
    next = next.filter(panel => !edit.removed.includes(panel.id));
    for (const panel of edit.changed) {
      const index = next.findIndex(p => p.id === panel.id);
      if (index < 0) next.push(panel);
      else next[index] = panel;
    }
  }
  if (next.length > MAX_WEB_PANELS) throw new Error("Pinned navigation is full on another device");
  return next;
}

export function createWebPanelSync(request: Request, legacy: readonly WebPanel[], changed: () => void) {
  let base: WebPanelsSnapshot | undefined;
  let panels = [...legacy];
  let status: PanelsSyncStatus = "loading";
  const edits: Edit[] = [];
  let migration: Edit | undefined;
  let flight: Promise<void> | undefined;
  const update = () => { panels = apply(base?.panels ?? legacy, edits); changed(); };
  const refresh = (): Promise<void> => {
    if (flight) return flight;
    flight = (async () => {
      try {
        if (!base) {
          base = checked(await request());
          if (base.revision === 0 && legacy.length) {
            migration = { removed: [], changed: [...legacy] };
            edits.unshift(migration);
          }
        } else if (!edits.length) base = checked(await request());
        update();
        for (let conflicts = 0; edits.length && conflicts < 3; conflicts++) {
          const count = edits.length;
          const next = apply(base.panels, edits.slice(0, count));
          try {
            base = checked(await request({ revision: base.revision, panels: next }));
            edits.splice(0, count);
            migration = undefined;
            update();
          } catch (error) {
            if ((error as { status?: number }).status !== 409) throw error;
            base = checked(await request());
            if (migration && base.revision > 0) {
              const index = edits.indexOf(migration);
              if (index >= 0) edits.splice(index, 1);
              migration = undefined;
            }
            update();
          }
        }
        status = edits.length ? "pending" : "synced";
      } catch {
        status = "error";
      } finally {
        flight = undefined;
        changed();
      }
    })();
    return flight;
  };
  return {
    refresh,
    panels: () => panels,
    status: () => status,
    set(next: readonly WebPanel[]) {
      const normalized = parseWebPanels(JSON.stringify(next));
      const before = panels;
      edits.push({ removed: before.filter(p => !normalized.some(n => n.id === p.id)).map(p => p.id),
        changed: normalized.filter(p => !before.some(b => b.id === p.id && JSON.stringify(b) === JSON.stringify(p))) });
      panels = normalized;
      status = "pending";
      changed();
      void refresh();
    },
  };
}
