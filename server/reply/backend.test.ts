import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReplyBackend } from "./backend.ts";
import type { RouteContext } from "../routes/table.ts";
import type { RequestAuth } from "../request-auth.ts";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));

it("retains drafts across backend recreation and enforces human review on the mounted route", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "reply-backend-"));
  directories.push(dataDir);
  let deliveries = 0;
  const bindings = { dataDir, visible: () => true, deliver: async () => { deliveries++; return { id: "receipt" }; } };
  const first = createReplyBackend(bindings);
  const draft = first.store.create("bot", "thread", { channel: "email", from: "owner@example.com", to: ["client@example.com"], cc: [], bcc: [], subject: "Fixture", text: "Saved draft", mailbox: "INBOX" });
  const restarted = createReplyBackend(bindings);
  async function request(auth: RequestAuth, method: string, suffix = "", body = {}) {
    let answer: { status: number; body: any } | undefined;
    await restarted.route({ path: `/api/reply-drafts/${draft.id}${suffix}`, method, auth,
      req: { headers: { "content-type": "application/json" } }, res: { setHeader() {} },
      readBody: async () => body, json: (_res: unknown, status: number, body: unknown) => { answer = { status, body }; },
    } as unknown as RouteContext);
    return answer!;
  }
  const human: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
  const read = await request(human, "GET");
  expect(read.status).toBe(200);
  expect(read.body.draft.content.text).toBe("Saved draft");
  expect((await request({ kind: "loopback", trust: "service", scopes: ["client"] }, "POST", "/send", { revision: 1, hash: read.body.hash })).status).toBe(403);
  expect(deliveries).toBe(0);
  expect((await request(human, "POST", "/send", { revision: 1, hash: read.body.hash })).body.draft.state).toBe("sent");
  expect(deliveries).toBe(1);
  expect(createReplyBackend(bindings).store.read(draft.id).state).toBe("sent");
});

it("refuses an unspecified persistent workspace", () => {
  expect(() => createReplyBackend({ dataDir: "", visible: () => true, deliver: async () => ({ id: "unused" }) })).toThrow("existing workspace");
});
