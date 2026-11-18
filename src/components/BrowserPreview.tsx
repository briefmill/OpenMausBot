import { useEffect, useRef, useState } from "react";
import { useStore, type Bot } from "@/state/store";
import { browserStreamAccess, createPreviewFramePainter, createPreviewStreamClient, type PreviewStreamClient } from "@/lib/browser-stream-client";
import { browserScope } from "@/lib/team-browser";
import { usePageVisible } from "@/lib/page-visible";

export const BROWSER_THUMBNAIL_INTERVAL_MS = 15_000;

export function BrowserPreview({ bot, live, running = true }: { bot: Bot; live: boolean; running?: boolean }) {
  const { state } = useStore();
  const canvas = useRef<HTMLCanvasElement>(null);
  const visible = usePageVisible();
  const [inView, setInView] = useState(false);
  const [painted, setPainted] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const threadId = browserScope(state.config?.team, bot.threadId).threadId;
  const frameKey = `${bot.id}:${bot.browserProfile ?? ""}:${threadId ?? ""}`;
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { root: node.closest('[data-activity-list], [data-team-canvas]') });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const node = canvas.current;
    if (!node || !visible || !inView || !running) return;
    let stopped = false;
    let client: PreviewStreamClient | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const painter = createPreviewFramePainter(node, () => { if (!stopped) { setPainted(frameKey); setProblem(null); } });
    const disconnect = () => { client?.stop(); client = undefined; clearTimeout(timeout); };
    const connect = () => {
      disconnect();
      client = createPreviewStreamClient({
        access: browserStreamAccess(bot.id, window.location, threadId ? { threadId } : {}),
        maxWidth: live ? 768 : 384, maxHeight: live ? 480 : 240, interactive: false, existingOnly: true,
      }, {
        onFrame: (frame) => { painter.paint(frame); if (!live) disconnect(); },
        onViewport: () => {}, onConnectedChange: () => {},
        onUnauthorized: () => { setProblem("Preview access unavailable"); disconnect(); },
        onGone: () => { setProblem("Browser is no longer running"); disconnect(); },
        onHostSetup: () => { setProblem("Browser setup is required"); disconnect(); },
      });
      if (!live) timeout = setTimeout(disconnect, 5_000);
    };
    connect();
    const timer = live ? undefined : setInterval(connect, BROWSER_THUMBNAIL_INTERVAL_MS);
    return () => { stopped = true; clearInterval(timer); disconnect(); painter.stop(); };
  }, [bot.id, bot.browserProfile, frameKey, inView, live, running, threadId, visible]);
  const showing = painted === frameKey;
  return <span data-browser-preview={bot.id} data-preview-mode={live ? "live" : "thumbnail"} className="relative block aspect-video w-full overflow-hidden rounded-lg bg-inset">
    <canvas ref={canvas} aria-hidden className={`size-full object-contain ${showing ? "" : "invisible"}`} />
    {(!showing || problem) && <span className="absolute inset-0 flex items-center justify-center bg-inset/90 px-3 text-center text-[12px] text-ink-secondary">{problem ?? (running ? "Waiting for browser preview…" : "Browser is idle")}</span>}
    {showing && !problem && <span className="absolute bottom-2 right-2 rounded bg-inset/90 px-2 py-0.5 text-[10px] text-ink-secondary">{live ? "Live · read-only" : "Thumbnail"}</span>}
  </span>;
}
