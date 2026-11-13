// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const api = vi.hoisted(() => vi.fn());
vi.mock("@/state/api", () => ({ api }));
import { BrainPanel } from "./BrainPanel";
it("shows saved provenance as text without executing stored HTML or framing credentials", async () => {
  api.mockResolvedValue({ scope: "bvs", limit: 20, fetchedAt: 2000, records: [{ id: "a", title: "Synthetic client", body: '<img src="https://untrusted.invalid/" onerror="alert(1)">', source: "synthetic://fixture", occurred_at: 1, created: 2 }] });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => { root.render(createElement(BrainPanel)); });
    expect(host.textContent).toContain("Synthetic client"); expect(host.textContent).toContain("synthetic://fixture");
    expect(host.querySelector("img,iframe")).toBeNull(); expect(host.querySelector("pre")?.textContent).toContain("onerror");
    expect(host.textContent).toContain("Per-bot reads and writes are not yet tracked");
    expect([...host.querySelectorAll("option")].map(option => option.textContent)).toEqual(["BVS", "Briefmill", "Proxie / ProxyScore", "Inner Clip", "Coordinator summaries"]);
  } finally { act(() => root.unmount()); host.remove(); }
});
it("keeps Graphify scripts in a sandbox without same-origin or navigation permissions", async () => {
  api.mockImplementation((url: string) => Promise.resolve(url.includes("view=graph")
    ? { scope: "bvs", html: "<p>synthetic graph</p>", recordCount: 1, nodes: 3, edges: 2, basis: "Document headings" }
    : { scope: "bvs", records: [], limit: 20, fetchedAt: 2000 }));
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => { root.render(createElement(BrainPanel)); });
    await act(async () => { [...host.querySelectorAll("button")].find(button => button.textContent === "Graph")!.click(); });
    expect(host.querySelector("iframe")?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(host.querySelector("iframe")?.getAttribute("src")).toBeNull();
    expect(host.textContent).toContain("Document headings");
  } finally { act(() => root.unmount()); host.remove(); }
});
