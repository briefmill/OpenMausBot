import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createTeamMapLayoutRoutes, type TeamMapLayout } from "./team-map-layout.ts";
import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "omb-map-layout-"));
  const route = createTeamMapLayoutRoutes(dir);
  let auth: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://127.0.0.1");
    try { await route({ req, res, url, path: url.pathname, method: req.method!, auth, json, readBody }); }
    catch { json(res, 500, { error: "fixture route failed" }); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); rmSync(dir, { recursive: true }); });
  const request = (body?: unknown) => fetch(`http://127.0.0.1:${port}/api/team-map/layout`, body === undefined ? {} : { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { dir, request, auth: (next: RequestAuth) => { auth = next; } };
}
it("persists layouts and merges separate devices' departments without resetting screen preference", async () => {
  const f = await fixture();
  expect((await (await f.request()).json() as { layout: TeamMapLayout }).layout).toEqual({ positions: {}, botOrders: {} });
  await f.request({ positions: { BVS: { x: 120, y: 80 } }, showScreens: false });
  await f.request({ botOrders: { Briefmill: ["b", "a"] }, positions: { Briefmill: { x: 600, y: 80 } } });
  const saved = (await (await f.request()).json() as { layout: TeamMapLayout }).layout;
  expect(saved).toEqual({ positions: { BVS: { x: 120, y: 80 }, Briefmill: { x: 600, y: 80 } }, botOrders: { Briefmill: ["b", "a"] }, showScreens: false });
  const { readFileSync, readdirSync } = await import("node:fs");
  const file = join(f.dir, "team-map-layouts", readdirSync(join(f.dir, "team-map-layouts"))[0]);
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(saved);
});
it("imports a local layout only when the server has no layout", async () => {
  const f = await fixture();
  await f.request({ initialize: true, positions: { BVS: { x: 10, y: 20 } } });
  await f.request({ initialize: true, positions: { BVS: { x: 999, y: 999 } } });
  expect((await (await f.request()).json() as { layout: TeamMapLayout }).layout.positions.BVS).toEqual({ x: 10, y: 20 });
});
it("rejects invalid coordinates and overlarge layouts without overwriting saved data", async () => {
  const f = await fixture();
  expect((await f.request({ positions: { BVS: { x: 1e9, y: 0 } } })).status).toBe(400);
  expect((await f.request({ positions: Object.fromEntries(Array.from({ length: 201 }, (_, n) => [String(n), { x: 0, y: 0 }])) })).status).toBe(400);
  expect((await (await f.request()).json() as { layout: TeamMapLayout }).layout.positions).toEqual({});
});
it("blocks guest and shared-service callers", async () => {
  const f = await fixture();
  f.auth({ kind: "loopback", scopes: ["client"], trust: "service" });
  expect((await f.request()).status).toBe(403);
  expect((await f.request({ showScreens: true })).status).toBe(403);
});

it("saves VM and browser visibility independently across devices", async () => {
  const f = await fixture();
  await f.request({ showScreens: true, showBrowsers: false });
  await f.request({ showBrowsers: true });
  expect((await (await f.request()).json()).layout).toMatchObject({ showScreens: true, showBrowsers: true });
  await f.request({ showScreens: false });
  expect((await (await f.request()).json()).layout).toMatchObject({ showScreens: false, showBrowsers: true });
});
