// @vitest-environment happy-dom
import { flushSync } from "react-dom";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@astryxdesign/core/reset.css?inline", () => ({ default: "" }));
vi.mock("@astryxdesign/core/astryx.css?inline", () => ({ default: "" }));
import { browserMessage, mountBrowserPicker } from "./browser-picker";
import { registerDraft } from "./browser-picker-draft";
let cleanup: (() => void) | undefined;
let unregister: (() => void) | undefined;
afterEach(() => { flushSync(() => cleanup?.()); unregister?.(); document.body.replaceChildren(); });
it("shows active selection on the toolbar control and Escape exits", async () => {
  const host = document.createElement("omb-browser-picker"); document.body.append(host);
  const canvas = document.createElement("canvas"); document.body.append(canvas);
  unregister = registerDraft(() => ({ draftId: "fixture", recording: false, allowImages: true, imageSlots: 1, imageBytes: 1000, onFiles: vi.fn(), onText: vi.fn(), getText: () => "" }));
  flushSync(() => { cleanup = mountBrowserPicker(host, () => ({ scopeKey: "fixture", connected: true, control: {controller: "you"}, surface: () => canvas, send: vi.fn(), take: vi.fn() })); });
  const button = () => host.shadowRoot!.querySelector("button")!;
  expect(button().getAttribute("aria-pressed")).toBe("false");
  flushSync(() => button().click());
  expect(button().getAttribute("aria-pressed")).toBe("true");
  expect(button().getAttribute("title")).toContain("Annotation mode on");
  flushSync(() => document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true})));
  expect(button().getAttribute("aria-pressed")).toBe("false");
});
it("adds a captured element to an unsent draft without clicking the webpage", async () => {
  const host = document.createElement("omb-browser-picker"); document.body.append(host);
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 100; document.body.append(canvas);
  vi.spyOn(canvas,"getBoundingClientRect").mockReturnValue(new DOMRect(0,0,100,100));
  const send = vi.fn(); const onFiles = vi.fn(async () => {}); const onText = vi.fn(); const webpageClick = vi.fn(); canvas.addEventListener("click", webpageClick);
  unregister = registerDraft(() => ({ draftId: "fixture", recording: false, allowImages: true, imageSlots: 1, imageBytes: 1000, onFiles, onText, getText: () => "existing" }));
  flushSync(() => { cleanup = mountBrowserPicker(host, () => ({ scopeKey: "fixture", connected: true, control: {controller: "you"}, surface: () => canvas, send, take: vi.fn() })); });
  browserMessage("fixture", {type:"viewport",width:100,height:100});
  flushSync(() => host.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click());
  flushSync(() => canvas.dispatchEvent(new MouseEvent("click",{clientX:10,clientY:10,bubbles:true,cancelable:true})));
  expect(webpageClick).not.toHaveBeenCalled();
  const request = send.mock.calls[0][0]; expect(request.capture).toBe(true);
  browserMessage("fixture", {type:"ombElementInspection",requestId:request.requestId,image:btoa("png-fixture"),element:{url:"https://example.com/",tag:"h1",selector:"h1",label:"Heading",rect:{x:0,y:0,width:20,height:20}}});
  await vi.waitFor(() => expect(onFiles).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(onText).toHaveBeenCalledWith(expect.stringContaining("[Selected browser element]")));
});
