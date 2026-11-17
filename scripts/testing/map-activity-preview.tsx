import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { MapActivity } from "../../src/components/MapActivity";
import { BotEditorStore, initialState, type Bot } from "../../src/state/store";
import { applySkin } from "../../src/lib/skins";
import "../../src/styles.css";
applySkin("midnight");
function Preview() {
  const [opened, setOpened] = useState("");
  const [category, setCategory] = useState("bots");
  const [frame, setFrame] = useState(0);
  useEffect(() => { if (category !== "desktops") return; const timer = setInterval(() => setFrame(value => value + 1), 200); return () => clearInterval(timer); }, [category]);
  const frameUrl = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#172842"/><text x="30" y="60" fill="white" font-size="24">Isolated desktop frame ${frame}</text></svg>`)}`;
  const bots = [{id:"working",name:"Builder",busy:true,section:"Engineering"},{id:"approval",name:"Support",activity:"waiting-on-you",section:"BVS"},{id:"idle",name:"Idle bot"},{id:"hidden",name:"Private bot",hidden:true,busy:true}] as Bot[];
  return <main className="flex h-dvh justify-end bg-panel text-ink"><output data-opened={opened} className="p-8">{opened}</output><MapActivity onCategoryChange={setCategory} frames={{working:{url:frameUrl,at:Date.now(),version:String(frame)}}} bots={bots} computers={[
    {id:"working",name:"Build desktop",kind:"bot",botIds:["working"],state:"working"},
    {id:"sleep",name:"Sleeping desktop",kind:"bot",botIds:[],state:"asleep"},
  ]} activeBrowsers={["idle", "hidden"]} computerError={null} error={null} onClose={()=>setOpened("closed")} onBot={bot=>setOpened(`bot:${bot.id}`)} onDesktop={computer=>setOpened(`desktop:${computer.id}`)} onBrowser={bot=>setOpened(`browser:${bot.id}`)} onManage={()=>setOpened("manage")} /></main>;
}
createRoot(document.getElementById("root")!).render(<BotEditorStore value={{ state: initialState, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }}><Preview /></BotEditorStore>);
