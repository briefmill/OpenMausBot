import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { DATA_DIR } from "../config.ts";
import { ownerOrAdmin } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

const key = z.string().max(200);
const positions = z.record(key, z.object({ x: z.number().finite().min(-1e6).max(1e6), y: z.number().finite().min(-1e6).max(1e6) })).refine((v) => Object.keys(v).length <= 200);
const orders = z.record(key, z.array(z.string().max(200)).max(1000)).refine((v) => Object.keys(v).length <= 200);
const layoutSchema = z.object({ positions, botOrders: orders, showScreens: z.boolean().optional() });
const patchSchema = layoutSchema.partial().extend({ initialize: z.boolean().optional() });
export type TeamMapLayout = z.infer<typeof layoutSchema>;

export function createTeamMapLayoutRoutes(dataDir: string): RouteHandler {
  return async ({ path, method, auth, req, res, json, readBody }) => {
    if (path !== "/api/team-map/layout" || !["GET", "PATCH"].includes(method)) return PASS;
    if (!ownerOrAdmin(auth)) return json(res, 403, { error: "Only an owner device can arrange this map." });
    res.setHeader("cache-control", "no-store");
    const identity = auth.kind === "session" ? auth.session.userId ?? "owner" : "owner";
    const directory = join(dataDir, "team-map-layouts");
    const file = join(directory, createHash("sha256").update(identity).digest("hex") + ".json");
    const read = (): TeamMapLayout => {
      try { return layoutSchema.parse(JSON.parse(readFileSync(file, "utf8"))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { positions: {}, botOrders: {} }; throw error; }
    };
    if (method === "GET") return json(res, 200, { layout: read() });
    const parsed = patchSchema.safeParse(await readBody(req, 100_000));
    if (!parsed.success) return json(res, 400, { error: "Invalid map layout." });
    const current = read();
    const patch = parsed.data;
    if (patch.initialize && (Object.keys(current.positions).length || Object.keys(current.botOrders).length || current.showScreens !== undefined)) return json(res, 200, { layout: current });
    const next = layoutSchema.safeParse({ ...current, positions: { ...current.positions, ...patch.positions }, botOrders: { ...current.botOrders, ...patch.botOrders }, ...(patch.showScreens === undefined ? {} : { showScreens: patch.showScreens }) });
    if (!next.success) return json(res, 400, { error: "Map layout is too large." });
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(file + ".tmp", JSON.stringify(next.data), { mode: 0o600 });
    renameSync(file + ".tmp", file);
    return json(res, 200, { layout: next.data });
  };
}
export const teamMapLayoutRoutes = createTeamMapLayoutRoutes(DATA_DIR);
