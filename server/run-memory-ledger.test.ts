import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createRunMemoryLedger } from "./run-memory-ledger.ts";

it("persists separate runs through a writer reopen without treating shared peaks as additive", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omb-memory-ledger-"));
  try {
    const report = {
      runId: "run-one",
      threadId: "thread",
      startedAt: 1000,
      endedAt: 2000,
      sampledProcessGroupPeakBytes: 123,
      sharedProcess: true,
      samples: 2,
    };
    const first = createRunMemoryLedger(dir);
    first.record(report);
    await first.flush();
    const second = createRunMemoryLedger(dir);
    second.record({
      ...report,
      runId: "run-two",
      sampledProcessGroupPeakBytes: null,
      samples: 0,
    });
    await second.flush();
    const rows = readFileSync(join(dir, "run-memory", "1970-01.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(rows.map((row) => row.runId)).toEqual(["run-one", "run-two"]);
    expect(rows[0]).toMatchObject({ additive: false, sharedProcess: true });
    expect(rows[1]).toMatchObject({
      sampledProcessGroupPeakBytes: null,
      samples: 0,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("contains persistence errors without failing a turn or leaking report data", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omb-memory-failure-"));
  try {
    writeFileSync(join(dir, "run-memory"), "block directory");
    let failures = 0;
    const ledger = createRunMemoryLedger(dir, () => {
      failures++;
    });
    ledger.record({
      runId: "run",
      threadId: "thread",
      startedAt: 0,
      endedAt: 1,
      sampledProcessGroupPeakBytes: null,
      sharedProcess: false,
      samples: 0,
    });
    await ledger.flush();
    expect(failures).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("flushes a report emitted while providers shut down before graceful exit", async () => {
  const { createGracefulShutdown } = await import("./graceful-shutdown.ts");
  const dir = mkdtempSync(join(tmpdir(), "omb-memory-shutdown-"));
  try {
    const ledger = createRunMemoryLedger(dir);
    await new Promise<void>((resolve, reject) => {
      const shutdown = createGracefulShutdown({
        cleanup: [
          async () => {
            await Promise.resolve();
            ledger.record({
              runId: "final-run",
              threadId: "thread",
              turnId: "provider-turn",
              startedAt: 0,
              endedAt: 1,
              sampledProcessGroupPeakBytes: 42,
              sharedProcess: false,
              samples: 1,
            });
            await ledger.flush();
          },
        ],
        exit: () => {
          try {
            const row = JSON.parse(
              readFileSync(join(dir, "run-memory", "1970-01.jsonl"), "utf8"),
            );
            expect(row.turnId).toBe("provider-turn");
            resolve();
          } catch (error) {
            reject(error);
          }
        },
      });
      shutdown();
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("filters hidden threads, malformed records and extra fields from bounded memory reads", async () => {
  const { readRunMemory } = await import("./run-memory-ledger.ts");
  const dir = mkdtempSync(join(tmpdir(), "omb-memory-reader-"));
  try {
    const ledger = createRunMemoryLedger(dir);
    const row = {
      runId: "visible-run",
      threadId: "visible",
      startedAt: 0,
      endedAt: 1,
      sampledProcessGroupPeakBytes: 42,
      sharedProcess: true,
      samples: 1,
    };
    ledger.record(row);
    ledger.record({ ...row, runId: "hidden-run", threadId: "hidden" });
    await ledger.flush();
    const file = join(dir, "run-memory", "1970-01.jsonl");
    const { appendFileSync } = await import("node:fs");
    appendFileSync(
      file,
      "\ninvalid\n" +
        JSON.stringify({ ...row, runId: "extra", unexpected: "private text" }) +
        "\n",
    );
    const result = await readRunMemory(
      dir,
      { from: new Date(0), to: new Date(1000) },
      (id) => id === "visible",
    );
    expect(result.truncated).toBe(false);
    expect(result.rows.map((item) => item.runId)).toEqual([
      "visible-run",
      "extra",
    ]);
    expect(JSON.stringify(result)).not.toContain("hidden-run");
    expect(JSON.stringify(result)).not.toContain("private text");
    writeFileSync(file, "x".repeat(8 * 1024 * 1024 + 1));
    expect(
      await readRunMemory(
        dir,
        { from: new Date(0), to: new Date(1000) },
        () => true,
      ),
    ).toEqual({ rows: [], truncated: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("pages through visible records without exposing hidden rows and rejects forged boundaries", async () => {
  const { readRunMemory } = await import("./run-memory-ledger.ts");
  const dir = mkdtempSync(join(tmpdir(), "omb-memory-pages-"));
  try {
    const ledger = createRunMemoryLedger(dir);
    for (const [runId, threadId] of [
      ["one", "visible"],
      ["hidden", "private"],
      ["two", "visible"],
    ])
      ledger.record({
        runId,
        threadId,
        startedAt: 0,
        endedAt: 1,
        sampledProcessGroupPeakBytes: 42,
        sharedProcess: false,
        samples: 1,
      });
    await ledger.flush();
    const range = { from: new Date(0), to: new Date(1000) };
    const visible = (id: string) => id === "visible";
    const first = await readRunMemory(dir, range, visible, { limit: 1 });
    expect(first.rows.map((row) => row.runId)).toEqual(["one"]);
    const second = await readRunMemory(dir, range, visible, {
      limit: 1,
      cursor: first.next,
    });
    expect(second.rows.map((row) => row.runId)).toEqual(["two"]);
    const last = await readRunMemory(dir, range, visible, {
      limit: 1,
      cursor: second.next,
    });
    expect(last).toEqual({ rows: [], truncated: false });
    for (const cursor of [
      "../../bad:0",
      "1970-02:0",
      "1970-01:1",
      "1970-01:9999999",
    ])
      await expect(
        readRunMemory(dir, range, visible, { cursor }),
      ).rejects.toThrow(RangeError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
