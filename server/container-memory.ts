import { posix } from "node:path";
import type { HostMemory } from "./engine-memory.ts";

const bytes = (value: string | undefined): number | null => {
  if (!value || !/^\d+$/.test(value.trim())) return null;
  const number = Number(value.trim());
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
};

/** Effective cgroup v2 memory, including tighter ancestor limits. Host values apply where no controller is mounted. */
export function containerMemory(host: HostMemory, read: (path: string) => string): HostMemory {
  const text = (path: string): string | undefined => { try { return read(path); } catch { return undefined; } };
  const membership = /^0::(\/[^\n]*)$/m.exec(text("/proc/self/cgroup") ?? "")?.[1];
  const mounts = (text("/proc/self/mountinfo") ?? "").split("\n");
  let result = { ...host };
  for (const line of mounts) {
    if (!line.includes(" - cgroup2 ")) continue;
    const fields = line.split(" ");
    const root = fields[3], mount = fields[4];
    if (!root || !mount || !membership || root.includes("\\") || mount.includes("\\")) continue;
    const relative = posix.relative(root, membership);
    if (relative === ".." || relative.startsWith("../")) continue;
    let folder = posix.join(mount, relative);
    while (true) {
      const limit = bytes(text(`${folder}/memory.max`));
      if (limit !== null && limit > 0) {
        result.containerLimited = true;
        const current = bytes(text(`${folder}/memory.current`));
        result.totalBytes = Math.min(result.totalBytes, limit);
        result.availableBytes = Math.min(result.availableBytes, current === null ? 0 : Math.max(0, limit - current));
        const swapLimit = bytes(text(`${folder}/memory.swap.max`));
        const swapCurrent = bytes(text(`${folder}/memory.swap.current`));
        result.swapFreeBytes = Math.min(result.swapFreeBytes, swapLimit === null || swapCurrent === null ? 0 : Math.max(0, swapLimit - swapCurrent));
      }
      const taskLimit = bytes(text(`${folder}/pids.max`));
      if (taskLimit !== null) {
        const current = bytes(text(`${folder}/pids.current`));
        result.taskLimit = Math.min(result.taskLimit ?? Infinity, taskLimit);
        result.availableTasks = Math.min(result.availableTasks ?? Infinity, current === null ? 0 : Math.max(0, taskLimit - current));
      }
      const killed = /^oom_kill (\d+)$/m.exec(text(`${folder}/memory.events`) ?? "");
      if (folder === posix.join(mount, relative)) {
        if (killed) result.oomKills = Number(killed[1]);
        const stall = /^full avg10=([\d.]+)/m.exec(text(`${folder}/memory.pressure`) ?? "");
        if (stall) result.fullStall10 = Number(stall[1]);
      }
      if (folder === mount) break;
      const parent = posix.dirname(folder);
      if (parent === folder || !parent.startsWith(mount)) break;
      folder = parent;
    }
  }
  return result;
}
