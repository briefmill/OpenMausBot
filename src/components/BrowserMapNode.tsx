import { useEffect, useRef, useState } from "react";
import { useStore, type Bot } from "@/state/store";
import { browserStreamAccess, createPreviewFramePainter, createPreviewStreamClient } from "@/lib/browser-stream-client";
import { browserScope } from "@/lib/team-browser";
import { usePageVisible } from "@/lib/page-visible";
import { t } from "@/lib/i18n";
import type { MapComputerState } from "../../shared/map-computer";
import { ComputerNode } from "./ComputerNode";

export function BrowserMapNode({ bot, x, y, onOpen }: { bot: Bot; x: number; y: number; onOpen?: () => void }) {
  const { state } = useStore();
  const canvas = useRef<HTMLCanvasElement>(null);
  const visible = usePageVisible();
  const [inView, setInView] = useState(false);
  const [status, setStatus] = useState<MapComputerState>("idle");
  const [painted, setPainted] = useState<string | null>(null);
  const threadId = browserScope(state.config?.team, bot.threadId).threadId;
  const frameKey = `${bot.id}:${bot.browserProfile ?? ""}:${threadId ?? ""}`;
  const showing = painted === frameKey && visible && inView && bot.busy;
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const root = node.closest("[data-team-canvas]");
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { root });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const node = canvas.current;
    if (!node || !visible || !inView || !bot.busy) { setStatus("idle"); return; }
    setPainted(null);
    setStatus("starting");
    const painter = createPreviewFramePainter(node, () => { setPainted(frameKey); setStatus("working"); });
    const client = createPreviewStreamClient({
      access: browserStreamAccess(bot.id, window.location, threadId ? { threadId } : {}),
      maxWidth: 512, maxHeight: 320, interactive: false, existingOnly: true,
    }, {
      onFrame: painter.paint,
      onViewport: () => {},
      onConnectedChange: (connected) => { if (!connected) { setPainted(null); setStatus("idle"); } },
      onUnauthorized: () => { setPainted(null); setStatus("off"); },
      onGone: () => { setPainted(null); setStatus("off"); },
      onHostSetup: () => { setPainted(null); setStatus("problem"); },
      onControl: (control) => { if (control.controller !== "agent") { setPainted(null); setStatus("idle"); } },
    });
    return () => { client.stop(); painter.stop(); setPainted(null); };
  }, [bot.id, bot.browserProfile, bot.busy, threadId, visible, inView, frameKey]);
  return <ComputerNode computer={{ id: `browser:${bot.id}`, kind: "bot", name: bot.name, botIds: [bot.id], state: status }}
    bots={[bot]} x={x} y={y} state={status} onOpen={onOpen} label={t("mapBrowser.name", { name: bot.name })}
    surface={<span className="relative block size-full">
      <canvas ref={canvas} aria-hidden className={`size-full object-contain ${showing ? "" : "invisible"}`} />
      {!showing && <span className="absolute inset-0 flex items-center justify-center px-3 text-center text-[11px] text-white/45">{t(bot.busy ? "mapBrowser.waiting" : "mapBrowser.idle")}</span>}
    </span>} />;
}
