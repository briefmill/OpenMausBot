import { createRoot } from "react-dom/client";
import { useState } from "react";
import { MapActivity } from "../../src/components/MapActivity";
import type { Bot } from "../../src/state/store";
import { applySkin } from "../../src/lib/skins";
import "../../src/styles.css";
applySkin("midnight");
function Preview() {
  const [opened, setOpened] = useState("");
  const bots = [{id:"working",name:"Builder",busy:true,section:"Engineering"},{id:"approval",name:"Support",activity:"waiting-on-you",section:"BVS"},{id:"idle",name:"Idle bot"},{id:"hidden",name:"Private bot",hidden:true,busy:true}] as Bot[];
  return <main className="flex h-dvh justify-end bg-panel text-ink"><output data-opened={opened} className="p-8">{opened}</output><MapActivity bots={bots} computers={[
    {id:"working",name:"Build desktop",kind:"bot",botIds:["working"],state:"working"},
    {id:"sleep",name:"Sleeping desktop",kind:"bot",botIds:[],state:"asleep"},
  ]} activeBrowsers={["idle", "hidden"]} computerError={null} error={null} onClose={()=>setOpened("closed")} onBot={bot=>setOpened(`bot:${bot.id}`)} onDesktop={computer=>setOpened(`desktop:${computer.id}`)} onBrowser={bot=>setOpened(`browser:${bot.id}`)} onManage={()=>setOpened("manage")} /></main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
