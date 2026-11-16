import { useState } from "react";
import { createRoot } from "react-dom/client";
import { StoreProvider, type Bot } from "../../src/state/store";
import { TeamCanvas } from "../../src/components/TeamCanvas";
import { buildTeamMapSections } from "../../src/lib/team-map";
import { applySkin } from "../../src/lib/skins";
import "../../src/styles.css";

applySkin(new URLSearchParams(location.search).get("skin") === "daylight" ? "daylight" : "midnight");
const payload = await fetch("/api/bots").then((response) => response.json());
const bots: Bot[] = payload.bots.filter((bot: Bot) => bot.name.startsWith("Demo ")).map((bot: Bot) => ({ ...bot, busy: true }));
function Fixture() {
  const [show, setShow] = useState(true);
  const [opened, setOpened] = useState("");
  return <div className="flex h-dvh flex-col bg-panel text-ink">
    <header className="flex items-center justify-between border-b border-hairline px-6 py-4">
      <div><h1 className="text-xl font-semibold">Team map · Live browser previews</h1><p className="text-sm text-ink-secondary">Isolated demo · temporary browsers · no client data</p></div>
      <button className="rounded-lg border border-hairline bg-control px-4 py-2" aria-pressed={show} onClick={() => setShow(!show)}>Show screens</button>
    </header>
    <TeamCanvas sections={buildTeamMapSections(bots, ["Engineering"])} canManage={false}
      onMove={async () => false} onInstructions={() => {}} onEditTeam={() => {}} onDeleteTeam={() => {}} isEmpty={() => false}
      showBrowsers={show} onOpenBrowser={(bot) => setOpened(bot.id)} />
    <footer className="border-t border-hairline px-6 py-3 text-sm text-ink-secondary" data-opened={opened}>Same monitor component and canvas layout as the VM previews. Click a browser monitor to open its existing viewer.</footer>
  </div>;
}
createRoot(document.getElementById("root")!).render(<StoreProvider><Fixture /></StoreProvider>);
