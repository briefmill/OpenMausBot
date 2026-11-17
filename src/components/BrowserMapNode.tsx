import type { Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { ComputerNode } from "./ComputerNode";
import { BrowserPreview } from "./BrowserPreview";

export function BrowserMapNode({ bot, x, y, onOpen, running = bot.busy === true }: { bot: Bot; x: number; y: number; onOpen?: () => void; running?: boolean }) {
  const status = running ? "working" : "idle";
  return <ComputerNode computer={{ id: `browser:${bot.id}`, kind: "bot", name: bot.name, botIds: [bot.id], state: status }}
    previewKind="browser" bots={[bot]} x={x} y={y} state={status} onOpen={onOpen} label={t("mapBrowser.name", { name: bot.name })}
    surface={<BrowserPreview bot={bot} live={false} running={running} />} />;
}
