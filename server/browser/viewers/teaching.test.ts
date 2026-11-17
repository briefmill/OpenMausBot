import { describe, expect, it, vi } from "vitest";
import { BrowserTeaching, teachingUrl } from "./teaching.ts";
import type { CdpPage } from "../cdp/page.ts";

describe("browser demonstration evidence", () => {
  it("removes credentials, query strings and fragments from network URLs", () => {
    expect(teachingUrl("https://user:secret@example.com/form?token=secret#private")).toBe("https://example.com/form");
    expect(teachingUrl("data:text/plain,secret")).toBe("data:");
    expect(teachingUrl("not a URL")).toBe("");
  });
  it("captures accepted action metadata without typed content or network headers", async () => {
    const emitted: Record<string, unknown>[] = [];
    const listeners = new Map<string, (value: Record<string, unknown>) => void>();
    const off = vi.fn();
    const page = { url: () => "https://example.com/form?token=secret", evaluate: vi.fn(async () => ({ tag: "input", id: "password", inputType: "password" })),
      session: { on: (name: string, listener: (value: Record<string, unknown>) => void) => { listeners.set(name, listener); return off; } } } as unknown as CdpPage;
    const recording = new BrowserTeaching((event) => emitted.push(event));
    await recording.input(page, { type: "text", text: "super-secret" }); expect(emitted).toEqual([]);
    recording.start();
    await recording.input(page, { type: "text", text: "super-secret" });
    await recording.input(page, { type: "key", action: "down", key: "X", text: "X" });
    listeners.get("Network.responseReceived")!({ type: "Fetch", response: { url: "https://user:secret@example.com/save?key=secret", status: 200, headers: { Authorization: "secret" }, body: "secret" } });
    const json = JSON.stringify(emitted);
    expect(json).not.toContain("secret"); expect(json).not.toContain('"key":"X"');
    expect(emitted).toContainEqual(expect.objectContaining({ kind: "action", target: { tag: "input", id: "password", inputType: "password" } }));
    expect(emitted).toContainEqual(expect.objectContaining({ kind: "network", status: 200, url: "https://example.com/save" }));
    recording.stop(); expect(off).toHaveBeenCalledTimes(3);
    const count = emitted.length; await recording.input(page, { type: "mouse", action: "down", x: 10, y: 20 }); expect(emitted).toHaveLength(count);
  });
});
