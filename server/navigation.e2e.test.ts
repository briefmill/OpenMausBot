import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import { requiredScope } from "./request-auth.ts";
import { webPanelsRecord } from "./web-panels.ts";

it("shares persisted navigation between paired owner devices, refuses stale writes and excludes client-only sessions", async () => {
  const fixture = await launchVerificationServer();
  const path = "/api/workspace/navigation";
  const call = async (method: string, endpoint = path, body?: unknown, token?: string) => {
    const response = await fetch(fixture.info.url + endpoint, { method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as any, cache: response.headers.get("cache-control") };
  };
  const pair = async (scopes: string[]) => {
    const code = await call("POST", "/api/auth/pairing", { label: "Fixture device", scopes });
    expect(code.status).toBe(200);
    const paired = await call("POST", "/api/auth/pair", { code: code.body.code });
    expect(paired.status).toBe(200);
    return paired.body.token as string;
  };
  try {
    expect(requiredScope("GET", path)).toBe("admin");
    expect(requiredScope("GET", "/api/workspace/brain")).toBe("admin");
    expect(requiredScope("PUT", path)).toBe("admin");
    const windows = await pair(["admin", "client"]);
    const phone = await pair(["admin", "client"]);
    const chatOnly = await pair(["client"]);
    expect((await call("GET", "/api/workspace/brain", undefined, chatOnly)).status).toBe(403);
    expect((await call("GET", "/api/workspace/brain", undefined, windows)).status).toBe(503);
    expect((await call("GET", path, undefined, windows)).body).toEqual({ revision: 0, panels: [] });
    const panels = [{ id: "brain", name: "Brain", url: "https://brain.example/" }];
    expect((await call("PUT", path, { revision: 0, panels }, windows)).status).toBe(200);
    const seen = await call("GET", path, undefined, phone);
    expect(seen.body).toEqual({ revision: 1, panels });
    expect(seen.cache).toBe("private, no-store");
    expect((await call("PUT", path, { revision: 0, panels: [] }, phone)).status).toBe(409);
    expect((await call("GET", path, undefined, chatOnly)).status).toBe(403);
    expect((await call("PUT", path, { revision: 1, panels: [] }, chatOnly)).status).toBe(403);
    expect((await call("PUT", path, { revision: 1, panels: [{ id: "bad", name: "Bad", url: "javascript:alert(1)" }] }, windows)).status).toBe(400);
    const file = join(fixture.info.dataDir, "navigation.json");
    expect(webPanelsRecord(file).current()).toEqual(seen.body);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(seen.body);
    expect((await call("PUT", path, { revision: 1, panels: [] }, phone)).body).toEqual({ revision: 2, panels: [] });
    expect((await call("GET", path, undefined, windows)).body).toEqual({ revision: 2, panels: [] });
  } finally {
    await fixture.close();
  }
}, 60_000);
