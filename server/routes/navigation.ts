import { validPanelsSnapshot } from "../web-panels.ts";
import type { webPanelsRecord } from "../web-panels.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const NAVIGATION_PATH = "/api/workspace/navigation";

export function createNavigationRoutes(store: ReturnType<typeof webPanelsRecord>): RouteHandler {
  return async ({ req, res, path, method, json, readBody }) => {
    if (path !== NAVIGATION_PATH) return PASS;
    res.setHeader("cache-control", "private, no-store");
    if (method === "GET") return json(res, 200, store.current());
    if (method !== "PUT") return json(res, 405, { error: "Use GET or PUT." });
    const body: unknown = await readBody(req, 32_000);
    if (!validPanelsSnapshot(body)) return json(res, 400, { error: "Invalid pinned navigation settings." });
    const before = store.current();
    if (body.revision !== before.revision) return json(res, 409, { error: "Pinned navigation changed on another device.", current: before });
    const next = { revision: before.revision + 1, panels: body.panels };
    store.save(next);
    return json(res, 200, next);
  };
}
