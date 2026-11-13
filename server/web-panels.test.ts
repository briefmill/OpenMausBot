import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validPanelsSnapshot, webPanelsRecord } from "./web-panels.ts";

describe("durable pinned navigation", () => {
  it("retains ordered URL and chat pins after reopening its record", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-navigation-record-"));
    try {
      const file = join(dir, "navigation.json");
      const store = webPanelsRecord(file);
      expect(store.current()).toEqual({ revision: 0, panels: [] });
      const value = { revision: 1, panels: [
        { id: "brain", name: "Brain", url: "https://brain.example/" },
        { id: "page", name: "Report", page: { botId: "b", threadId: "t", messageId: "m" } },
      ] };
      store.save(value);
      expect(webPanelsRecord(file).current()).toEqual(value);
      if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
      writeFileSync(file, "corrupt");
      expect(() => store.current()).toThrow();
      expect(readFileSync(file, "utf8")).toBe("corrupt");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("refuses unsafe URLs, invalid revisions, duplicate IDs and oversized lists", () => {
    const pin = { id: "brain", name: "Brain", url: "https://brain.example/" };
    for (const value of [null, {}, { revision: -1, panels: [] }, { revision: 0.5, panels: [] },
      { revision: 1, panels: [pin, pin] }, { revision: 1, panels: [{ ...pin, url: "javascript:alert(1)" }] },
      { revision: 1, panels: [{ ...pin, url: "https://user:password@example.com/" }] },
      { revision: 1, panels: Array.from({ length: 7 }, (_, i) => ({ ...pin, id: String(i) })) },
    ]) expect(validPanelsSnapshot(value)).toBe(false);
  });
});
