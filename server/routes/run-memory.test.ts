import { readBody } from "../harness/http.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { createRunMemoryLedger } from "../run-memory-ledger.ts";
import { requiredScope } from "../request-auth.ts";
import { createUsageRoutes, type UsageRouteDeps } from "./usage.ts";
import type { RouteContext } from "./table.ts";

it("requires admin access and applies chat visibility before returning memory records", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omb-memory-route-"));
  try {
    const ledger = createRunMemoryLedger(dir);
    const row = {
      runId: "visible-run",
      threadId: "visible",
      startedAt: 0,
      endedAt: 1,
      sampledProcessGroupPeakBytes: 42,
      sharedProcess: false,
      samples: 1,
    };
    ledger.record(row);
    ledger.record({ ...row, runId: "hidden-run", threadId: "hidden" });
    const deps = {
      dataDir: dir,
      flushMemory: ledger.flush,
      prices: () => null,
      budget: () => null,
      currency: () => "USD",
      recorder: { liveTurns: () => [] },
      messages: () => [],
      liveBot: () => null,
      canSee: () => (id: string) => id === "visible",
      rowFor: () => (item: unknown) => item,
    } as unknown as UsageRouteDeps;
    const route = createUsageRoutes(deps);
    const call = async (
      admin: boolean,
      path = "/api/usage/memory?from=1970-01-01&to=1970-01-01",
    ) => {
      let response: { status: number; body: any } | undefined;
      const headers: Record<string, string> = {};
      const url = new URL(path, "http://test");
      await route({
        req: {} as IncomingMessage,
        readBody,
        res: {
          setHeader: (name: string, value: string) => {
            headers[name] = value;
          },
        } as unknown as ServerResponse,
        url,
        path: url.pathname,
        method: "GET",
        auth: {
          kind: "loopback",
          scopes: admin ? ["admin", "client"] : ["client"],
        },
        json: ((_res: unknown, status: number, body: unknown) => {
          response = { status, body };
        }) as RouteContext["json"],
      } as RouteContext);
      return { response, headers };
    };
    expect(requiredScope("GET", "/api/usage/memory")).toBe("admin");
    expect((await call(false)).response?.status).toBe(403);
    const allowed = await call(true);
    expect(allowed.response?.status).toBe(200);
    expect(allowed.response?.body.rows.map((item: any) => item.runId)).toEqual([
      "visible-run",
    ]);
    expect(allowed.response?.body.additive).toBe(false);
    expect(allowed.headers["cache-control"]).toBe("private, no-store");
    expect(
      (await call(true, "/api/usage/memory?from=bad")).response?.status,
    ).toBe(400);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
