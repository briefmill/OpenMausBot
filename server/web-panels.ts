import { readFileSync } from "node:fs";
import { parseWebPanels, type WebPanelsSnapshot } from "../shared/web-panels.ts";
import { writeFileAtomic } from "./atomic.ts";

export function validPanelsSnapshot(value: unknown): value is WebPanelsSnapshot {
  if (!value || typeof value !== "object") return false;
  const { revision, panels } = value as WebPanelsSnapshot;
  return Number.isSafeInteger(revision) && revision >= 0 && Array.isArray(panels)
    && JSON.stringify(parseWebPanels(JSON.stringify(panels))) === JSON.stringify(panels);
}

export function webPanelsRecord(file: string) {
  const current = (): WebPanelsSnapshot => {
    try {
      const value: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (!validPanelsSnapshot(value)) throw new Error("Invalid pinned navigation record");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { revision: 0, panels: [] };
      throw error;
    }
  };
  const save = (value: WebPanelsSnapshot): void => {
    if (!validPanelsSnapshot(value)) throw new Error("Invalid pinned navigation record");
    writeFileAtomic(file, JSON.stringify(value) + "\n", { mode: 0o600 });
  };
  return { current, save };
}
