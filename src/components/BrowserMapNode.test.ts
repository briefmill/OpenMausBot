// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import type { PreviewStreamEvents, PreviewStreamTarget } from "@/lib/browser-stream-client";

const fixture = vi.hoisted(() => ({
  visible: true, observer: null as ((entries: Array<{ isIntersecting: boolean }>) => void) | null,
  streams: [] as Array<{ target: PreviewStreamTarget; events: PreviewStreamEvents; stop: ReturnType<typeof vi.fn> }>,
  painted: null as (() => void) | null,
}));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: { config: { team: true } } }) }));
vi.mock("@/lib/page-visible", () => ({ usePageVisible: () => fixture.visible }));
vi.mock("./Avatar", () => ({ BotAvatar: () => null }));
vi.mock("@/lib/browser-stream-client", async (original) => ({
  ...await original<typeof import("@/lib/browser-stream-client")>(),
  createPreviewFramePainter: (_canvas: HTMLCanvasElement, painted: () => void) => {
    fixture.painted = painted;
    return { paint: () => painted(), stop: vi.fn() };
  },
  createPreviewStreamClient: (target: PreviewStreamTarget, events: PreviewStreamEvents) => {
    const stop = vi.fn(); fixture.streams.push({ target, events, stop }); return { stop, send: vi.fn() };
  },
}));
const { BrowserMapNode } = await import("./BrowserMapNode");
let root: Root;
let bot: Bot;
let onOpen: ReturnType<typeof vi.fn<() => void>>;
const draw = () => flushSync(() => root.render(createElement(BrowserMapNode, { bot, x: 20, y: 40, onOpen })));
beforeEach(() => {
  fixture.visible = true; fixture.streams = []; fixture.observer = null;
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: typeof fixture.observer) { fixture.observer = callback; }
    observe() {} disconnect() {}
  });
  const element = document.createElement("div"); document.body.append(element); root = createRoot(element);
  bot = { id: "scout", name: "Scout", busy: true, browser: true, threadId: "private-thread" } as Bot;
  onOpen = vi.fn(); draw();
});
afterEach(() => { flushSync(() => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
const enter = () => flushSync(() => fixture.observer?.([{ isIntersecting: true }]));
it("reuses the VM monitor, connects only while visible, and watches the exact conversation without input or resizing", () => {
  expect(document.querySelector('[data-computer-node="browser:scout"]')).not.toBeNull();
  expect(fixture.streams).toHaveLength(0); enter();
  expect(fixture.streams).toHaveLength(1);
  expect(fixture.streams[0].target).toMatchObject({ interactive: false, existingOnly: true, maxWidth: 512, maxHeight: 320 });
  expect(fixture.streams[0].target).not.toHaveProperty("width");
  expect(fixture.streams[0].target.access.query).toMatchObject({ threadId: "private-thread" });
  flushSync(() => fixture.streams[0].events.onFrame(new ArrayBuffer(1)));
  expect(document.querySelector("canvas")?.classList.contains("invisible")).toBe(false);
  document.querySelector("button")!.click(); expect(onOpen).toHaveBeenCalledOnce();
  flushSync(() => fixture.observer?.([{ isIntersecting: false }]));
  expect(fixture.streams[0].stop).toHaveBeenCalledOnce();
});
it("stops and hides stale pixels while idle or the app is in the background", () => {
  enter(); flushSync(() => fixture.streams[0].events.onFrame(new ArrayBuffer(1)));
  bot = { ...bot, busy: false }; draw();
  expect(fixture.streams[0].stop).toHaveBeenCalledOnce();
  expect(document.querySelector("canvas")?.classList.contains("invisible")).toBe(true);
  fixture.visible = false; bot = { ...bot, busy: true }; draw(); expect(fixture.streams).toHaveLength(1);
});
it("closes the old conversation before watching another and clears pixels after access is lost", () => {
  enter(); bot = { ...bot, threadId: "other-thread" }; draw();
  expect(fixture.streams[0].stop).toHaveBeenCalledOnce(); expect(fixture.streams).toHaveLength(2);
  flushSync(() => fixture.streams[1].events.onFrame(new ArrayBuffer(1)));
  flushSync(() => fixture.streams[1].events.onUnauthorized());
  expect(document.querySelector("canvas")?.classList.contains("invisible")).toBe(true);
});
