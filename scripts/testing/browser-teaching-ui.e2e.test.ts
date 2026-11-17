import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../control-omb.ts";
import { fixtureApi, mountPreview } from "./preview-fixture.ts";
import { agentBrowser, sessionEnv } from "./control-omb-ui.ts";
import { startService } from "../../server/browser/testing/real-service.ts";
import { CHROME } from "../../server/browser/cdp/testing/real-chrome.ts";
import { FixtureServer } from "../../server/browser/cdp/testing/fixtures.ts";
import { StreamV2 } from "../../server/browser/viewers/stream-v2.ts";
import { createBrowserViewerRoutes } from "../../server/routes/browser-viewers.ts";
import { createUpgrades } from "../../server/routes/upgrades.ts";
import { dispatchRoutes } from "../../server/routes/table.ts";
import type { RequestAuth } from "../../server/request-auth.ts";
const LOOPBACK: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
import { json, readBody } from "../../server/harness/http.ts";

const binary = process.env.OMB_MAP_TEST_AGENT_BROWSER;
(CHROME && binary ? it : it.skip)("records browser video and action evidence, then attaches both when training stops", async () => {
  const fixture = await launchVerificationServer();
  const real = await startService();
  const pages = await FixtureServer.start();
  const api = fixtureApi(fixture.info.url);
  const targets = new Map<string, { session: string; key: string }>();
  let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
  let bridge: ReturnType<typeof createServer> | undefined;
  const env = sessionEnv({ home: fixture.info.dataDir, session: "teaching-ui", chrome: CHROME! });
  try {
    const { bot } = await api("POST", "/api/bots", { name: "Demo Training", browser: true });
    const target = { session: bot.id, key: `bot:${bot.id}` }; targets.set(bot.id, target);
    const url = pages.page("/form", `<!doctype html><style>body{background:#eee;font:24px sans-serif;padding:30px}button{font:inherit;padding:12px}</style><h1>Demo lead form</h1><button id="save" onclick="this.textContent='Draft saved'">Save draft</button>`);
    expect((await real.call(target, "agent_browser_open", { url })).isError).toBeUndefined();
    const stream = new StreamV2({ service: real.service });
    const upgrades = createUpgrades();
    const route = createBrowserViewerRoutes({ upgrades, dataDir: fixture.info.dataDir, person: () => "fixture", audience: () => "team",
      browser: async (botId) => targets.has(botId) ? { botId, session: botId, spec: { command: "omb-cdp", args: [], env: {} } } : { status: 404, error: "No fixture bot" },
      authorize: async () => null, current: (botId) => targets.has(botId), restartRefusal: () => "No restarts in this fixture",
      viewers: { open: async () => {}, action: async () => ({}), stream: ({ session, spec: _spec, ...request }) => { stream.open({ ...request, target: targets.get(session)! }); return true; }, fileChooserOffered: () => false, answerFileChooser: async () => false, download: () => undefined },
    });
    const dispatch = async (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      await dispatchRoutes([route], { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: LOOPBACK, json, readBody }).then((handled) => {
        if (handled) return;
        const upstream = httpRequest(new URL(req.url ?? "/", fixture.info.url), { method: req.method, headers: req.headers }, (response) => { res.writeHead(response.statusCode ?? 500, response.headers); response.pipe(res); });
        upstream.on("error", () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
      });
    };

    bridge = createServer(dispatch); upgrades.attach(bridge, dispatch);
    await new Promise<void>((resolve) => bridge!.listen(0, "127.0.0.1", resolve));
    preview = await mountPreview({ info: { url: `http://127.0.0.1:${(bridge.address() as AddressInfo).port}` } }, {
      entry: "/scripts/testing/browser-teaching-preview.tsx", route: "/__teaching.html", title: "MausBot training isolated fixture", webSockets: true,
    });
    await agentBrowser(binary!, env, ["open", preview.previewUrl]);
    await agentBrowser(binary!, env, ["set", "viewport", "1440", "960"]);
    const evaluate = async (js: string) => (await agentBrowser(binary!, env, ["eval", js])).result;
    await expect.poll(() => evaluate("document.querySelector('canvas:not(.invisible)') !== null"), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Record training session')?.disabled"), { timeout: 10_000 }).toBe(false);
    await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Record training session').click()");
    await expect.poll(() => evaluate("document.body.innerText.includes('Stop training session')"), { timeout: 10_000 }).toBe(true);
    const evidence = join(process.cwd(), "docs/verification/images/browser-teaching"); mkdirSync(evidence, { recursive: true });
    await agentBrowser(binary!, env, ["screenshot", join(evidence, "recording.png")]);
    const buttonPoint = await real.peek<{ x: number; y: number; width: number; height: number }>(target, `(()=>{const r=document.querySelector('#save').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth,height:innerHeight}})()`);
    const canvasBox = JSON.parse(await evaluate("JSON.stringify((()=>{const r=document.querySelector('canvas:not(.invisible)').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})())") as string);
    const x = Math.round(canvasBox.x + buttonPoint.x * canvasBox.width / buttonPoint.width);
    const y = Math.round(canvasBox.y + buttonPoint.y * canvasBox.height / buttonPoint.height);
    await agentBrowser(binary!, env, ["mouse", "move", String(x), String(y)]);
    await agentBrowser(binary!, env, ["mouse", "down", "left"]);
    await agentBrowser(binary!, env, ["mouse", "up", "left"]);
    await expect.poll(() => real.peek(target, "document.querySelector('#save').textContent")).toBe("Draft saved");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Stop training session')).click()");
    await expect.poll(() => evaluate("document.querySelector('output').textContent"), { timeout: 15_000 }).toBe("Training saved and sent to the bot");
    const result = JSON.parse(await evaluate("document.querySelector('output').dataset.trainingResult") as string);
    expect(result.text).toContain('.webm'); expect(result.text).toContain('.json');
    const { readdirSync, readFileSync } = await import("node:fs");
    const files: string[] = [];
    const walk = (dir: string) => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir,entry.name); if (entry.isDirectory()) walk(path); else files.push(path); } };
    walk(fixture.info.dataDir);
    const actionLog = [...result.text.matchAll(/<attached-file path="([^"]+)" name="([^"]+)"/g)].find((match) => match[2].endsWith('.json'))![1];
    const log = JSON.parse(readFileSync(actionLog, 'utf8'));
    expect(log.complete).toBe(true);
    expect(log.events).toContainEqual(expect.objectContaining({ kind: 'action', target: expect.objectContaining({ selector: '#save' }) }));
    const webm = files.find((file) => file.endsWith('.webm'))!;
    expect(readFileSync(webm).subarray(0,4).toString('hex')).toBe('1a45dfa3');
    writeFileSync(join(evidence, "demonstration.webm"), readFileSync(webm));
    await agentBrowser(binary!, env, ["screenshot", join(evidence, "saved.png")]);
    await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Teach by demonstration').click()");
    await expect.poll(() => evaluate("document.body.innerText.includes('Stop training session')"), { timeout: 10_000 }).toBe(true);
    await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Stop training session')).click()");
    await expect.poll(() => evaluate("document.body.innerText.includes('Saving training')"), { timeout: 10_000 }).toBe(false);
  } catch (error) {
    console.log("Training UI diagnostic", await agentBrowser(binary!, env, ["eval", "document.body.innerText"]).catch(() => ({})));
    console.log(await agentBrowser(binary!, env, ["errors"]).catch(() => ({}))); throw error;
  } finally {
    await agentBrowser(binary!, env, ["close"]).catch(() => {});
    await preview?.close();
    if (bridge) { bridge.closeAllConnections(); await new Promise<void>((resolve) => bridge!.close(() => resolve())); }
    await real.close(); await pages.close(); await fixture.close();
  }
}, 120_000);
