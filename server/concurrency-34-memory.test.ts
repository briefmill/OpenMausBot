import { describe, expect, it } from "vitest";
import { EngineMemory, engineMemoryEnabled } from "./engine-memory.ts";

// Admission-policy checks with synthetic memory readings, not hardware benchmarks.
describe("34 independent process admissions", () => {
  it.each([
    { label: "ample capacity", total: 64 * 1024 ** 3, available: 60 * 1024 ** 3, admitted: 34 },
    { label: "8 GB container with 5 GB available", total: 8_000_000_000, available: 5_000_000_000, admitted: 5 },
  ])("respects measured headroom on $label", async ({ total, available, admitted }) => {
    const memory = new EngineMemory({ enabled: true, tickMs: 60_000, groups: () => new Map(),
      read: () => ({ containerLimited: true, totalBytes: total, availableBytes: available, swapFreeBytes: 0, oomKills: 0, fullStall10: 0 }), log: () => {} });
    memory.useCap({ most: () => undefined, waitsOnOthers: () => false });
    const controllers = Array.from({ length: 34 }, () => new AbortController());
    const started: string[] = [];
    const attempts = controllers.map(async (controller, i) => {
      const id = `bot-${i}`;
      const accepted = await memory.admit(id, controller.signal, () => {}, "process");
      if (accepted) { started.push(id); memory.turnStarted(id); }
      return accepted;
    });
    try {
      await expect.poll(() => started.length, { timeout: 2_000, interval: 10 }).toBe(admitted);
      expect(new Set(started).size).toBe(admitted);
    } finally {
      for (const controller of controllers) controller.abort();
      await Promise.all(attempts);
      for (const id of started) memory.turnEnded(id);
    }
    expect((await Promise.all(attempts)).filter(Boolean)).toHaveLength(admitted);
  });
});

it("enables Linux self-hosted admission without changing hosted plan identity", () => {
  expect(engineMemoryEnabled({}, "linux")).toBe(false);
  expect(engineMemoryEnabled({ OMB_MEMORY_GATE: "1" }, "linux")).toBe(true);
  expect(engineMemoryEnabled({ OMB_MEMORY_GATE: "1" }, "win32")).toBe(false);
  expect(engineMemoryEnabled({ OMB_CLOUD_ROLE: "home" }, "linux")).toBe(true);
  expect(engineMemoryEnabled({ OMB_CLOUD_ROLE: "team", OMB_MEMORY_GATE: "0" }, "linux")).toBe(true);
});
