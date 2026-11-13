import { expect, it, vi } from "vitest";
import type { RouteContext } from "./table.ts";
import { createBrainViewRoutes } from "./brain-view.ts";

const record = { id: "a".repeat(64), title: "Synthetic record", body: "Fixture text", source: "synthetic://source", occurred_at: 1, created: 2 };
async function call(options: { admin?: boolean; method?: string; query?: string; token?: string; response?: Response; throws?: boolean } = {}) {
  let status = 0; let body: unknown;
  const remote = vi.fn(async () => { if (options.throws) throw new Error("PRIVATE_CREDENTIAL fixture"); return options.response ?? Response.json({ result: { structuredContent: { result: [record] } } }); });
  const handler = createBrainViewRoutes({ token: () => options.token === "" ? undefined : "PRIVATE_CREDENTIAL fixture token value", fetch: remote as typeof fetch });
  await handler({ path: "/api/workspace/brain", method: options.method ?? "GET", url: new URL("http://fixture/api/workspace/brain" + (options.query ?? "")),
    auth: options.admin === false ? { kind: "loopback", scopes: ["client"], trust: "service" } : { kind: "loopback", scopes: ["admin", "client"] },
    res: { setHeader: vi.fn() }, json: (_res: unknown, code: number, value: unknown) => { status = code; body = value; },
  } as unknown as RouteContext);
  return { status, body, remote };
}
it("serves bounded read-only records through the fixed authenticated brain transport", async () => {
  const result = await call({ query: "?scope=bvs&query=Fixture" });
  expect(result.status).toBe(200); expect(result.body).toMatchObject({ scope: "bvs", records: [record], limit: 20 });
  const [url, init] = result.remote.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://graphify-brain-production.up.railway.app/bvs/");
  expect(init.redirect).toBe("error"); expect(JSON.parse(init.body as string).params).toEqual({ name: "recall", arguments: { query: "Fixture", limit: 20 } });
  expect(JSON.stringify(result.body)).not.toContain("PRIVATE_CREDENTIAL");
});
it("refuses service callers, writes, personal scope and missing configuration before transport", async () => {
  for (const [options, expected] of [[{ admin: false },403],[{ method: "POST" },405],[{ query: "?scope=personal" },400],[{ token: "" },503]] as const) {
    const result = await call(options); expect(result.status).toBe(expected); expect(result.remote).not.toHaveBeenCalled();
  }
});
it("routes each additional business scope to its own fixed upstream namespace", async () => {
  for (const scope of ["briefmill", "proxie", "innerclip"]) {
    const result = await call({ query: "?scope=" + scope });
    expect(result.status).toBe(200);
    const [url] = result.remote.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graphify-brain-production.up.railway.app/" + scope + "/");
    expect(result.body).toMatchObject({ scope });
  }
});
it("redacts transport failures, rejects remote MCP errors and rejects oversized records", async () => {
  for (const options of [{ throws: true },{ response: Response.json({ result: { isError: true, content: [{ type: "text", text: "PRIVATE_CREDENTIAL" }] } }) },
    { response: Response.json({ result: { structuredContent: { result: [{ ...record, body: "x".repeat(20001) }] } } }) }]) {
    const result = await call(options); expect(result.status).toBe(502); expect(JSON.stringify(result.body)).not.toContain("PRIVATE_CREDENTIAL");
  }
});
it("also accepts the MCP text-content representation of a record list", async () => {
  const result = await call({ response: Response.json({ result: { content: [{ type: "text", text: JSON.stringify([record]) }] } }) });
  expect(result.status).toBe(200); expect(result.body).toMatchObject({ records: [record] });
});
it("removes viewer credentials from the environment before engine children can inherit them", async () => {
  vi.stubEnv("OMB_BRAIN_VIEWER_TOKENS", JSON.stringify({ bvs: "synthetic-token-value-at-least-32-characters" }));
  try {
    vi.resetModules(); const module = await import("./brain-view.ts");
    expect(process.env.OMB_BRAIN_VIEWER_TOKENS).toBeUndefined();
    expect(module.configuredBrainViewToken("bvs")).toBe("synthetic-token-value-at-least-32-characters");
    expect(module.configuredBrainViewToken("personal")).toBeUndefined();
  } finally { vi.unstubAllEnvs(); }
});
it("proxies only the read-only graph tool and rejects malformed graph responses", async () => {
  const graph = { html: "<!doctype html><p>synthetic graph</p>", recordCount: 2, nodes: 4, edges: 2, basis: "Document structure" };
  const result = await call({ query: "?view=graph&scope=bvs", response: Response.json({ result: { structuredContent: graph } }) });
  expect(result.status).toBe(200); expect(result.body).toMatchObject(graph);
  const [, init] = result.remote.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(init.body as string).params).toEqual({ name: "graph_view", arguments: { query: "" } });
  for (const invalid of [{ ...graph, nodes: 1601 }, { ...graph, recordCount: 51 }, { ...graph, html: 3 }]) {
    expect((await call({ query: "?view=graph", response: Response.json({ result: { structuredContent: invalid } }) })).status).toBe(502);
  }
  expect((await call({ query: "?view=write" })).status).toBe(400);
});
