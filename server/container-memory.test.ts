import { describe, expect, it } from "vitest";
import { containerMemory } from "./container-memory.ts";
import { EngineMemory, readHostMemory } from "./engine-memory.ts";

const GB = 1024 ** 3;
const host = { totalBytes: 64 * GB, availableBytes: 40 * GB, swapFreeBytes: 8 * GB, oomKills: 19, fullStall10: 0 };
const files = (extra: Record<string, string> = {}) => {
  const entries: Record<string, string> = {
    "/proc/self/cgroup": "0::/tenant/app\n",
    "/proc/self/mountinfo": "42 21 0:28 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n",
    "/sys/fs/cgroup/tenant/app/memory.max": String(8 * GB),
    "/sys/fs/cgroup/tenant/app/memory.current": String(7.5 * GB),
    "/sys/fs/cgroup/tenant/app/memory.swap.max": "0",
    "/sys/fs/cgroup/tenant/app/memory.swap.current": "0",
    "/sys/fs/cgroup/tenant/app/memory.events": "oom 2\noom_kill 1\n",
    "/sys/fs/cgroup/tenant/app/memory.pressure": "full avg10=25.00 avg60=0 total=1\n",
    ...extra,
  };
  return (path: string): string => { if (!(path in entries)) throw new Error("ENOENT"); return entries[path]!; };
};

describe("container memory admission", () => {
  it("uses the Railway-sized container rather than host RAM or host swap", () => {
    expect(containerMemory(host, files())).toEqual({ containerLimited: true, totalBytes: 8 * GB, availableBytes: 0.5 * GB, swapFreeBytes: 0, oomKills: 1, fullStall10: 25 });
    const memory = new EngineMemory({ enabled: true, read: () => containerMemory(host, files()) });
    expect(memory.headroom()).toBe(0.1);
  });
  it("honors tighter ancestor limits even when the leaf is unlimited", () => {
    const result = containerMemory(host, files({
      "/sys/fs/cgroup/tenant/app/memory.max": "max",
      "/sys/fs/cgroup/tenant/memory.max": String(4 * GB),
      "/sys/fs/cgroup/tenant/memory.current": String(3.9 * GB),
    }));
    expect(result.totalBytes).toBe(4 * GB);
    expect(result.availableBytes).toBeLessThan(0.11 * GB);
  });
  it("reads a namespaced controller mount", () => {
    expect(containerMemory(host, files({
      "/proc/self/mountinfo": "42 21 0:28 /tenant /sys/fs/cgroup rw - cgroup2 cgroup rw\n",
      "/sys/fs/cgroup/app/memory.max": String(2 * GB),
      "/sys/fs/cgroup/app/memory.current": String(GB),
    })).totalBytes).toBe(2 * GB);
  });
  it("queues conservatively when a finite controller has unreadable usage", () => {
    expect(containerMemory(host, files({ "/sys/fs/cgroup/tenant/app/memory.current": "invalid" })).availableBytes).toBe(0);
  });
  it("clamps an exhausted container to zero", () => {
    expect(containerMemory(host, files({ "/sys/fs/cgroup/tenant/app/memory.current": String(9 * GB) })).availableBytes).toBe(0);
  });
  it("retains host accounting on an uncontained Linux host", () => {
    expect(containerMemory(host, () => { throw new Error("ENOENT"); })).toEqual(host);
  });
  it("feeds container accounting through the real host reader", () => {
    const read = files({ "/proc/meminfo": `MemTotal: ${64 * GB / 1024} kB\nMemAvailable: ${40 * GB / 1024} kB\nSwapFree: ${8 * GB / 1024} kB\n` });
    expect(readHostMemory(read)?.totalBytes).toBe(8 * GB);
  });
});

it("queues even the first run when its container is full, then starts when memory returns", async () => {
  let current = 7.9 * GB;
  const read = files();
  const memory = new EngineMemory({ enabled: true, tickMs: 5, groups: () => new Map(),
    read: () => containerMemory(host, path => path.endsWith("/memory.current") && path.includes("/app/") ? String(Math.floor(current)) : read(path)) });
  const notices: string[] = [];
  const controller = new AbortController();
  let admitted = false;
  const pending = memory.admit("scheduled", controller.signal, note => notices.push(note)).then(result => { admitted = result; return result; });
  await new Promise(resolve => setTimeout(resolve, 15));
  expect(admitted).toBe(false);
  expect(notices[0]).toContain("Waiting for memory");
  current = 3 * GB;
  await new Promise(resolve => setTimeout(resolve, 15));
  expect(await pending).toBe(true);
  memory.turnEnded("scheduled");
});

describe("container process and thread limits", () => {
  it("uses the tightest available ancestor task budget", () => {
    const result = containerMemory(host, files({
      "/sys/fs/cgroup/tenant/app/pids.max": "1000",
      "/sys/fs/cgroup/tenant/app/pids.current": "728",
      "/sys/fs/cgroup/tenant/pids.max": "2000",
      "/sys/fs/cgroup/tenant/pids.current": "1900",
    }));
    expect(result.taskLimit).toBe(1000);
    expect(result.availableTasks).toBe(100);
  });
  it.each(["invalid", "1001"])("reserves no task capacity for unusable or exhausted usage: %s", usage => {
    expect(containerMemory(host, files({
      "/sys/fs/cgroup/tenant/app/pids.max": "1000",
      "/sys/fs/cgroup/tenant/app/pids.current": usage,
    })).availableTasks).toBe(0);
  });
  it("does not invent a finite task limit for an unlimited controller", () => {
    const result = containerMemory(host, files({
      "/sys/fs/cgroup/tenant/app/pids.max": "max",
      "/sys/fs/cgroup/tenant/app/pids.current": "728",
    }));
    expect(result.taskLimit).toBeUndefined();
    expect(result.availableTasks).toBeUndefined();
  });
});
