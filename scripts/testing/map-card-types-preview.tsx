import { createRoot } from "react-dom/client";
import { BotEditorStore, initialState, type Bot } from "../../src/state/store";
import { ComputerNode } from "../../src/components/ComputerNode";
import { applySkin } from "../../src/lib/skins";
import "../../src/styles.css";
applySkin("midnight");
const bot = { id: "demo-support", name: "Client Support", color: "blue", modelSelection: { instanceId: "fixture", model: "fixture" } } as Bot;
createRoot(document.getElementById("root")!).render(<BotEditorStore value={{state:initialState,dispatch:()=>{},flushBotPatches:async()=>null,refreshInstances:async()=>{},refreshModels:async()=>{}}}>
  <main className="h-dvh bg-panel p-8 text-ink"><h1 className="text-xl">Team map · VM and browser cards</h1><p className="mt-2 text-ink-secondary">Isolated appearance preview</p><div className="relative mt-8 h-[260px]">
    <ComputerNode computer={{id:"vm",kind:"bot",name:bot.name,botIds:[bot.id],state:"asleep"}} bots={[bot]} state="asleep" x={0} y={0} />
    <ComputerNode computer={{id:"browser:demo",kind:"bot",name:bot.name,botIds:[bot.id],state:"idle"}} bots={[bot]} previewKind="browser" label="Client Support’s browser" state="idle" x={310} y={0} />
  </div></main>
</BotEditorStore>);
