import { describe, expect, it } from "vitest";
import { createWebPanelSync } from "./web-panel-sync";
import type { WebPanel, WebPanelsSnapshot } from "./web-panels";

const panel = (id: string): WebPanel => ({ id, name: id, url: `https://${id}.example/` });
function workspace() {
  let stored: WebPanelsSnapshot = { revision: 0, panels: [] };
  let offline = false;
  return {
    offline: (value: boolean) => { offline = value; },
    current: () => stored,
    async request(next?: WebPanelsSnapshot) {
      if (offline) throw new Error("offline");
      if (next) {
        if (next.revision !== stored.revision) throw Object.assign(new Error("conflict"), { status: 409 });
        stored = { revision: stored.revision + 1, panels: next.panels };
      }
      return structuredClone(stored);
    },
  };
}

describe("workspace pinned navigation synchronization", () => {
  it("adds and removes across two devices, including a fresh client", async () => {
    const server = workspace();
    const a = createWebPanelSync(server.request, [], () => {});
    const b = createWebPanelSync(server.request, [], () => {});
    await Promise.all([a.refresh(), b.refresh()]);
    a.set([panel("brain")]); await a.refresh(); await b.refresh();
    expect(b.panels()).toEqual(a.panels());
    b.set([]); await b.refresh(); await a.refresh();
    const fresh = createWebPanelSync(server.request, [panel("stale-local")], () => {});
    await fresh.refresh();
    expect(a.panels()).toEqual([]); expect(fresh.panels()).toEqual([]);
  });

  it("rebases concurrent additions without dropping either device's pin", async () => {
    const server = workspace();
    const a = createWebPanelSync(server.request, [], () => {});
    const b = createWebPanelSync(server.request, [], () => {});
    await Promise.all([a.refresh(), b.refresh()]);
    a.set([panel("brain")]); b.set([panel("ci")]);
    await Promise.all([a.refresh(), b.refresh()]); await a.refresh();
    expect(a.panels().map(p => p.id).sort()).toEqual(["brain", "ci"]);
    expect(b.status()).toBe("synced");
  });

  it("migrates legacy pins once; a stale device cannot resurrect deleted pins", async () => {
    const server = workspace();
    const a = createWebPanelSync(server.request, [panel("brain")], () => {});
    await a.refresh(); expect(server.current().panels).toEqual([panel("brain")]);
    a.set([]); await a.refresh();
    const b = createWebPanelSync(server.request, [panel("brain")], () => {});
    await b.refresh(); expect(b.panels()).toEqual([]);
  });

  it("does not overwrite the winner of simultaneous legacy migrations", async () => {
    const server = workspace();
    const a = createWebPanelSync(server.request, [panel("one")], () => {});
    const b = createWebPanelSync(server.request, [panel("two")], () => {});
    await Promise.all([a.refresh(), b.refresh()]);
    expect(server.current().panels).toHaveLength(1);
    await a.refresh(); expect(a.panels()).toEqual(b.panels());
  });

  it("keeps unsynced edits visible and retries after connectivity returns", async () => {
    const server = workspace(); const a = createWebPanelSync(server.request, [], () => {});
    await a.refresh(); server.offline(true);
    a.set([panel("brain")]); await a.refresh();
    expect(a.status()).toBe("error"); expect(a.panels()).toEqual([panel("brain")]);
    expect(server.current().panels).toEqual([]);
    server.offline(false); await a.refresh();
    expect(a.status()).toBe("synced"); expect(server.current().panels).toEqual([panel("brain")]);
  });

  it("does not mistake a malformed or old-server answer for an empty shared list", async () => {
    const a = createWebPanelSync(async () => ({} as WebPanelsSnapshot), [panel("brain")], () => {});
    await a.refresh(); expect(a.status()).toBe("error"); expect(a.panels()).toEqual([panel("brain")]);
  });
});
