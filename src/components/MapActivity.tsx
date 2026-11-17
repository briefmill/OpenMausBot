import { useState } from "react";
import { Activity, Bot as BotIcon, Globe, Monitor, X } from "lucide-react";
import type { Bot } from "@/state/store";
import type { MapComputer } from "../../shared/map-computer";
import { cn } from "@/lib/cn";

export function MapActivity({ bots, computers, activeBrowsers, computerError, error, onClose, onBot, onDesktop, onBrowser, onManage }: {
  bots: Bot[]; computers: MapComputer[]; activeBrowsers?: string[]; computerError: string | null; error: string | null;
  onClose(): void; onBot(bot: Bot): void; onDesktop(computer: MapComputer): void; onBrowser(bot: Bot): void; onManage?: () => void;
}) {
  const [tab, setTab] = useState<"bots" | "desktops" | "browsers">("bots");
  const active = bots.filter((bot) => !bot.hidden && (bot.busy || bot.activity === "working" || bot.activity === "waiting-on-you"));
  const desktops = computers.filter((computer) => ["starting", "working", "idle"].includes(computer.state));
  const browsers = bots.filter((bot) => !bot.hidden && bot.browser !== false && activeBrowsers?.includes(bot.id));
  const tabs = [{ id: "bots", label: "Active bots", icon: BotIcon, count: active.length }, { id: "desktops", label: "Active desktops", icon: Monitor, count: desktops.length }, { id: "browsers", label: "Active browsers", icon: Globe, count: activeBrowsers === undefined ? null : browsers.length }] as const;
  const rows = tab === "bots" ? active.map((bot) => ({ id: bot.id, name: bot.name, detail: bot.activity === "waiting-on-you" ? "Waiting for you" : "Working", section: bot.section, open: () => onBot(bot) }))
    : tab === "browsers" ? browsers.map((bot) => ({ id: bot.id, name: `${bot.name}’s browser`, detail: "Running", section: bot.section, open: () => onBrowser(bot) }))
    : desktops.map((computer) => ({ id: `${computer.kind}:${computer.id}`, name: computer.name, detail: computer.state === "working" ? "Working" : computer.state === "starting" ? "Starting" : "Ready", section: computer.section, open: () => onDesktop(computer) }));
  const problem = error || (tab === "desktops" ? computerError : null);
  return <aside aria-label="Activity" className="flex w-[340px] max-w-full shrink-0 flex-col border-l border-hairline/50 bg-panel text-ink">
    <header className="flex items-center gap-2 border-b border-hairline/40 px-4 py-4"><Activity size={17} /><h2 className="flex-1 text-[14px] font-medium">Activity</h2><button aria-label="Close activity" onClick={onClose} className="rounded-lg p-1.5 hover:bg-control"><X size={16} /></button></header>
    <div role="tablist" aria-label="Activity categories" className="space-y-1 border-b border-hairline/40 p-3">{tabs.map(({ id, label, icon: Icon, count }) => <button key={id} role="tab" aria-selected={tab === id} aria-controls="map-activity-list" id={`activity-${id}`} onClick={() => setTab(id)} className={cn("flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px]", tab === id ? "bg-accent/10 text-accent-text" : "text-ink-secondary hover:bg-control")}><Icon size={16} /><span className="flex-1">{label}</span><span>{count ?? "—"}</span></button>)}</div>
    <div id="map-activity-list" role="tabpanel" aria-labelledby={`activity-${tab}`} className="min-h-0 flex-1 overflow-y-auto p-3">
      {problem ? <p role="alert" className="p-3 text-[13px] text-danger">Activity could not refresh. {problem}</p> : tab === "browsers" && activeBrowsers === undefined ? <p className="p-3 text-[13px] text-ink-secondary">Browser activity is not available from this server yet.</p> : rows.length === 0 ? <p className="p-3 text-[13px] text-ink-secondary">No {tab === "bots" ? "active bots" : tab === "desktops" ? "active desktops" : "active browsers"} right now.</p> : <ul className="space-y-2">{rows.map((row) => <li key={row.id}><button onClick={row.open} className="w-full rounded-xl border border-hairline/50 bg-card px-3 py-3 text-left hover:bg-control"><span className="block truncate text-[13px] font-medium">{row.name}</span><span className="mt-1 block text-[12px] text-ink-secondary">{row.detail}{row.section ? ` · ${row.section}` : ""}</span></button></li>)}</ul>}
    </div>
    {onManage && <div className="border-t border-hairline/40 p-3"><button onClick={onManage} className="w-full rounded-lg px-3 py-2 text-left text-[13px] text-ink-secondary hover:bg-control">Manage desktops</button></div>}
  </aside>;
}
