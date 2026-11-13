import { BRAIN_VIEW_PATH, BRAIN_VIEW_SCOPES, type BrainViewRecord } from "../../shared/brain-view.ts";
import { ownerOrAdmin } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

const ORIGIN = "https://graphify-brain-production.up.railway.app";
export function createBrainViewRoutes(deps: { token(scope: string): string | undefined; fetch?: typeof fetch }): RouteHandler {
  return async ({ auth, res, path, method, url, json }) => {
    if (path !== BRAIN_VIEW_PATH) return PASS;
    res.setHeader("cache-control", "private, no-store");
    if (!ownerOrAdmin(auth)) return json(res, 403, { error: "Workspace admin access required." });
    if (method !== "GET") return json(res, 405, { error: "This viewer is read-only." });
    const scope = url.searchParams.get("scope") ?? "bvs";
    const query = url.searchParams.get("query") ?? "";
    const view = url.searchParams.get("view") ?? "records";
    if (view !== "records" && view !== "graph") return json(res, 400, { error: "Invalid view." });
    if (!(BRAIN_VIEW_SCOPES as readonly string[]).includes(scope) || query.length > 200) return json(res, 400, { error: "Invalid scope or search." });
    const token = deps.token(scope);
    if (!token) return json(res, 503, { error: "Brain viewer connection is not configured for this scope." });
    try {
      const response = await (deps.fetch ?? fetch)(`${ORIGIN}/${scope}/`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: view === "graph" ? { name: "graph_view", arguments: { query } } : { name: "recall", arguments: { query, limit: 20 } } }),
      });
      if (!response.ok || !response.body) throw new Error("Unavailable");
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
      try {
        for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > (view === "graph" ? 4_000_000 : 2_000_000)) throw new Error("Oversize"); chunks.push(next.value); }
      } finally { await reader.cancel().catch(() => undefined); }
      const answer = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (answer.error || answer.result?.isError) throw new Error("Refused");
      const content = answer.result?.content?.find((item: { type?: string }) => item.type === "text");
      const data = answer.result?.structuredContent ?? (content ? JSON.parse(content.text) : null);
      if (view === "graph") {
        const graph = data?.result ?? data;
        if (!graph || typeof graph.html !== "string" || Buffer.byteLength(graph.html) > 1_500_000
          || typeof graph.basis !== "string" || graph.basis.length > 500
          || !Number.isInteger(graph.recordCount) || graph.recordCount < 0 || graph.recordCount > 50
          || !Number.isInteger(graph.nodes) || graph.nodes < 0 || graph.nodes > 1600
          || !Number.isInteger(graph.edges) || graph.edges < 0 || graph.edges > 10_000) throw new Error("Invalid graph");
        return json(res, 200, { scope, html: graph.html, recordCount: graph.recordCount, nodes: graph.nodes, edges: graph.edges, basis: graph.basis, fetchedAt: Date.now() });
      }
      const rows = Array.isArray(data) ? data : (Array.isArray(data?.result) ? data.result : data?.records);
      if (!Array.isArray(rows) || rows.length > 20) throw new Error("Invalid records");
      const records: BrainViewRecord[] = rows.map((row: BrainViewRecord) => {
        if (!row || typeof row.id !== "string" || !/^[a-f0-9]{32,64}$/.test(row.id)
          || typeof row.title !== "string" || row.title.length > 240 || typeof row.body !== "string" || row.body.length > 20_000
          || typeof row.source !== "string" || row.source.length > 1000 || !Number.isFinite(row.created)
          || (row.occurred_at !== null && !Number.isFinite(row.occurred_at))) throw new Error("Invalid record");
        return { id: row.id, title: row.title, body: row.body, source: row.source, occurred_at: row.occurred_at, created: row.created };
      });
      return json(res, 200, { scope, records, limit: 20, fetchedAt: Date.now() });
    } catch { return json(res, 502, { error: "Brain could not be read. No changes were made." }); }
  };
}

const viewerTokens: Record<string, unknown> = (() => {
  const raw = process.env.OMB_BRAIN_VIEWER_TOKENS;
  delete process.env.OMB_BRAIN_VIEWER_TOKENS;
  try {
    const value: unknown = JSON.parse(raw ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
})();

export function configuredBrainViewToken(scope: string): string | undefined {
  const value = viewerTokens[scope];
  return typeof value === "string" && value.length >= 32 ? value : undefined;
}
