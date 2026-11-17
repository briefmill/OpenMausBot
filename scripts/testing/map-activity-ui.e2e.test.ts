import { expect, it } from "vitest";
import { join } from "node:path";
import { launchVerificationServer } from "../control-omb.ts";
import { mountPreview } from "./preview-fixture.ts";
import { agentBrowser, sessionEnv } from "./control-omb-ui.ts";
const binary = process.env.OMB_MAP_TEST_AGENT_BROWSER;
const chrome = process.env.OMB_CDP_CHROME;
(binary && chrome ? it : it.skip)("lists current activity by kind and opens the selected resource without including idle or hidden bots", async () => {
  const fixture = await launchVerificationServer();
  const preview = await mountPreview(fixture, {entry:"/scripts/testing/map-activity-preview.tsx",route:"/__activity.html",title:"Activity fixture"});
  const env = sessionEnv({home:fixture.info.dataDir,session:"activity-ui",chrome:chrome!});
  const evaluate = async (code:string) => (await agentBrowser(binary!,env,["eval",code])).result;
  try {
    await agentBrowser(binary!,env,["open",preview.previewUrl]);
    await expect.poll(()=>evaluate(`!!document.querySelector('[role="tabpanel"]')`)).toBe(true);
    let text = await evaluate(`document.querySelector('[role="tabpanel"]').textContent`);
    expect(text).toContain("Builder"); expect(text).toContain("Waiting for you"); expect(text).not.toContain("Idle bot"); expect(text).not.toContain("Private bot");
    await evaluate(`document.querySelector('[role="tabpanel"] button').click()`);
    expect(await evaluate(`document.querySelector('output').dataset.opened`)).toBe("bot:working");
    await evaluate(`document.getElementById('activity-desktops').click()`);
    text = await evaluate(`document.querySelector('[role="tabpanel"]').textContent`);
    expect(text).toContain("Build desktop"); expect(text).not.toContain("Sleeping desktop");
    await evaluate(`document.querySelector('[role="tabpanel"] button').click()`);
    expect(await evaluate(`document.querySelector('output').dataset.opened`)).toBe("desktop:working");
    await evaluate(`document.getElementById('activity-browsers').click()`);
    text = await evaluate(`document.querySelector('[role="tabpanel"]').textContent`);
    expect(text).toContain("Idle bot’s browser"); expect(text).not.toContain("Builder"); expect(text).not.toContain("Private bot");
    await evaluate(`document.querySelector('[role="tabpanel"] button').click()`);
    expect(await evaluate(`document.querySelector('output').dataset.opened`)).toBe("browser:idle");
    await agentBrowser(binary!,env,["screenshot",join(process.cwd(),"../setup/map-activity-preview.png")]);
  } finally {
    await agentBrowser(binary!,env,["close"]).catch(()=>{}); await preview.close(); await fixture.close();
  }
},90_000);
