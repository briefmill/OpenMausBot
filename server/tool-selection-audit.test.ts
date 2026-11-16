import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ToolSelectionAudit } from "./tool-selection-audit.ts";
import { flushDecisionLog, readDecisions, withDecisionActor } from "./decision-log.ts";

it("records saved selection changes with the actor and caller, but ignores unrelated saves", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omb-selection-audit-"));
  try {
    const audit = new ToolSelectionAudit(dir);
    const bot = { id: "bot", threadId: "thread", name: "Fixture" };
    audit.prime([bot]);
    audit.saved([bot]);
    withDecisionActor({ kind: "loopback" }, () => audit.saved([{ ...bot, toolScope: { allow: ["native:read"] } }]));
    audit.saved([{ ...bot, toolScope: { allow: ["native:read"] } }]);
    audit.saved([bot]);
    await flushDecisionLog(dir);
    const rows = readDecisions(dir, 10);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ botId: "bot", tool: "tool-selection", actor: { kind: "loopback" }, decision: "configuration-saved" });
    expect(rows[0]!.rule).toContain("tool-selection-audit.test.ts");
    expect(rows[1]).toMatchObject({ actor: { kind: "worker" }, summary: expect.stringContaining("-> all") });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("starts from persisted selection without logging a restart as a change", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omb-selection-restart-"));
  try {
    const bot = { id: "bot", threadId: "thread", name: "Fixture", toolScope: { allow: ["native:write", "native:read"] } };
    const audit = new ToolSelectionAudit(dir);
    audit.prime([bot]);
    audit.saved([{ ...bot, toolScope: { allow: ["native:read", "native:write"] } }]);
    await flushDecisionLog(dir);
    expect(readDecisions(dir, 10)).toHaveLength(0);
    audit.saved([{ ...bot, toolScope: undefined }]);
    await flushDecisionLog(dir);
    expect(readDecisions(dir, 10)).toEqual([expect.objectContaining({
      botId: "bot", decision: "configuration-saved", summary: expect.stringContaining("-> all"),
    })]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("records internal connector permission changes even when native tool scope is unchanged", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omb-connector-audit-"));
  try {
    const audit = new ToolSelectionAudit(dir);
    const bot = { id: "bot", threadId: "thread", name: "Fixture" };
    audit.prime([bot]);
    audit.saved([{ ...bot, connectorScopes: { apps: { gmail: "read" as const } } }]);
    audit.saved([{ ...bot, connectorScopes: { apps: { gmail: "read" as const } }, connectorTools: { gmail: { tools: ["GMAIL_FETCH_EMAILS"] } } }]);
    await flushDecisionLog(dir);
    expect(readDecisions(dir, 10).map(row => row.tool)).toEqual(["connectorScopes", "connectorTools"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
