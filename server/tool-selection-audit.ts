import { appendDecision } from "./decision-log.ts";
import type { ToolScope } from "../shared/tool-scope.ts";
import type { WireBot } from "../packages/phone-protocol/src/wire.ts";

type Selection = { id: string; threadId: string; name: string; toolScope?: ToolScope } & Pick<WireBot, "connectorScopes" | "connectorTools">;
const selection = (scope: ToolScope | undefined): string => scope === undefined ? "all" : JSON.stringify({
  ...(scope.allow ? { allow: [...scope.allow].sort() } : {}),
  ...(scope.deny ? { deny: [...scope.deny].sort() } : {}),
});
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) :
  value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
const snapshot = (bot: Selection) => ({
  "tool-selection": selection(bot.toolScope),
  connectorScopes: JSON.stringify(canonical(bot.connectorScopes)) ?? "all",
  connectorTools: JSON.stringify(canonical(bot.connectorTools)) ?? "all",
});
type Snapshot = ReturnType<typeof snapshot>;

export class ToolSelectionAudit {
  private previous = new Map<string, Snapshot>();
  private readonly dataDir: string;
  constructor(dataDir: string) { this.dataDir = dataDir; }
  prime(bots: readonly Selection[]): void { this.previous = new Map(bots.map(bot => [bot.id, snapshot(bot)])); }
  saved(bots: readonly Selection[]): void {
    for (const bot of bots) {
      const next = snapshot(bot), before = this.previous.get(bot.id);
      for (const tool of Object.keys(next) as (keyof Snapshot)[]) {
        if (next[tool] === before?.[tool] || (!before && tool !== "tool-selection" && next[tool] === "all")) continue;
        appendDecision(this.dataDir, {
          threadId: bot.threadId, botId: bot.id, botName: bot.name, tool, source: "tool-selection", decision: "configuration-saved",
          summary: `Saved ${tool === "tool-selection" ? "tool selection" : tool}: ${before?.[tool] ?? "new bot"} -> ${next[tool]}`,
          rule: new Error().stack?.split("\n").slice(2, 6).map(line => line.trim()).join("; "),
        });
      }
    }
    this.prime(bots);
  }
}
