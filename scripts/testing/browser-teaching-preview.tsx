import { requestBrowserTeaching, teachingKey } from "../../src/lib/browser-teaching";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { initialState, BotEditorStore, type Bot, type Action } from "../../src/state/store";
import { LiveBrowser } from "../../src/components/BrowserPanel";
import { applySkin } from "../../src/lib/skins";
import "../../src/styles.css";
applySkin("midnight");
const payload = await fetch("/api/bots").then((response) => response.json());
const bot: Bot = payload.bots.find((candidate: Bot) => candidate.name === "Demo Training");
function Fixture() {
  const [sent, setSent] = useState<Action | null>(null);
  const state = { ...initialState, bots: [bot], config: { ...initialState.config, browserEngine: { kind: "engine", engine: "chrome" }, browserProfiles: [] } } as typeof initialState;
  return <BotEditorStore value={{ state, dispatch: setSent, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }}>
    <div className="flex h-dvh flex-col bg-panel text-ink p-4"><h1>Teach mode · isolated browser fixture</h1><button onClick={() => requestBrowserTeaching(teachingKey(bot.id), "/learn watch me save a draft")}>Teach by demonstration</button><div className="min-h-0 flex-1"><LiveBrowser bot={bot} /></div><output data-training-result={JSON.stringify(sent)}>{sent?.type === "send" ? "Training saved and sent to the bot" : "Demonstrate a workflow, then stop training."}</output></div>
  </BotEditorStore>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
