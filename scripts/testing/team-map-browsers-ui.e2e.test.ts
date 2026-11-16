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
(CHROME && binary ? it : it.skip)("draws live browsers on the real team canvas, opens the chosen bot, and disconnects when screens are hidden", async () => {
  const fixture = await launchVerificationServer();
  const real = await startService();
  const pages = await FixtureServer.start();
  const api = fixtureApi(fixture.info.url);
  const ids: string[] = [];
  const targets = new Map<string, { session: string; key: string }>();
  let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
  let bridge: ReturnType<typeof createServer> | undefined;
  const env = sessionEnv({ home: fixture.info.dataDir, session: "map-preview-ui", chrome: CHROME! });
  try {
    for (const [name, color, title] of [["Demo Iris", "#5d7df7", "Pull request review"], ["Demo Theo", "#16b9a6", "Staging verification"]]) {
      const { bot } = await api("POST", "/api/bots", { name, section: "Engineering", browser: true });
      await api("PATCH", `/api/bots/${bot.id}`, { browser: true });
      ids.push(bot.id);
      const target = { session: bot.id, key: `bot:${bot.id}` }; targets.set(bot.id, target);
      const url = pages.page(`/${bot.id}`, `<!doctype html><title>${title}</title><style>body{margin:0;background:#141827;color:#eef1fb;font:24px system-ui;padding:45px}small{color:#a2aac5}h1{font-size:40px}#progress{width:75%;height:18px;border-radius:10px;background:${color};transform-origin:left;animation:work 2s ease-in-out infinite alternate}@keyframes work{from{transform:scaleX(.35)}to{transform:scaleX(1)}}</style><small>MAUSBOT · ISOLATED BROWSER</small><h1>${title}</h1><p>${name.slice(5)} is working</p><div id=progress></div>`);
      const opened = await real.call(target, "agent_browser_open", { url });
      expect(opened.isError, real.text(opened)).toBeUndefined();
    }
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
    for (const section of ["General", "BVS", "Briefmill", "Proxie", "Inner Clip", "Personal"]) {
      await api("POST", "/api/bots", { name: `Demo ${section} specialist`, section, browser: false });
    }
    await api("PATCH", "/api/team-map/layout", { positions: Object.fromEntries(["Engineering", "General", "BVS", "Briefmill", "Proxie", "Inner Clip", "Personal"].map((key) => [key, { x: 40, y: 40 }])) });
    bridge = createServer(dispatch); upgrades.attach(bridge, dispatch);
    await new Promise<void>((resolve) => bridge!.listen(0, "127.0.0.1", resolve));
    preview = await mountPreview({ info: { url: `http://127.0.0.1:${(bridge.address() as AddressInfo).port}` } }, {
      entry: "/scripts/testing/team-map-browsers-preview.tsx", route: "/__map-browsers.html", title: "MausBot browser map isolated fixture", webSockets: true,
    });
    await agentBrowser(binary!, env, ["open", preview.previewUrl]);
    await agentBrowser(binary!, env, ["set", "viewport", "1440", "960"]);
    const evaluate = async (js: string) => (await agentBrowser(binary!, env, ["eval", js])).result;
    try { await expect.poll(() => evaluate("document.querySelectorAll('[data-computer-node^=\"browser:\"] canvas:not(.invisible)').length"), { timeout: 20_000 }).toBe(2); } catch (error) {
      console.log("Map fixture diagnostic", await evaluate("({text:document.body.innerText, nodes:document.querySelectorAll('[data-computer-node]').length, canvas:document.querySelectorAll('canvas').length})"), "streams", stream.size);
      console.log(await agentBrowser(binary!, env, ["errors"]));
      throw error;
    }
    const evidence = join(process.cwd(), "docs/verification/images/team-map-browsers"); mkdirSync(evidence, { recursive: true });
    await agentBrowser(binary!, env, ["screenshot", join(evidence, "live-browser-previews.png")]);
    await agentBrowser(binary!, env, ["record", "start", join(evidence, "live-browser-previews.webm"), "--fps", "10"]);
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    await agentBrowser(binary!, env, ["record", "stop"]);
    const connections = stream.size; expect(connections).toBe(2);
    await evaluate(`document.querySelector('[data-computer-node="browser:${ids[0]}"] button').click()`);
    await expect.poll(() => evaluate("document.querySelector('[data-opened]').dataset.opened")).toBe(ids[0]);
    await evaluate("document.querySelector('header button').click()");
    await expect.poll(() => stream.size, { timeout: 10_000 }).toBe(0);
    expect(await evaluate("document.querySelectorAll('[data-computer-node^=\"browser:\"]').length")).toBe(0);
    await agentBrowser(binary!, env, ["screenshot", join(evidence, "midnight-before.png")]);
    await agentBrowser(binary!, env, ["open", `${preview.previewUrl}?skin=daylight`]);
    await expect.poll(() => evaluate("document.querySelector('header button').getAttribute('aria-pressed')")).toBe("false");
    await evaluate("document.querySelector('header button').click()");
    await expect.poll(() => evaluate("document.querySelectorAll('[data-computer-node^=\"browser:\"] canvas:not(.invisible)').length"), { timeout: 20_000 }).toBe(2);
    await agentBrowser(binary!, env, ["screenshot", join(evidence, "daylight-after.png")]);
    await evaluate("document.querySelector('header button').click()");
    await expect.poll(() => stream.size, { timeout: 10_000 }).toBe(0);
    await agentBrowser(binary!, env, ["screenshot", join(evidence, "daylight-before.png")]);
    const initialPoint = JSON.parse(await evaluate("JSON.stringify((()=>{const r=document.querySelector('[data-arrange-team=Engineering]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})())") as string);
    expect(initialPoint.x).toBeGreaterThan(0);
    expect(initialPoint.y).toBeGreaterThan(0);
    const initialX = (await api("GET", "/api/team-map/layout")).layout.positions.Engineering.x;
    await agentBrowser(binary!, env, ["mouse", "move", String(Math.round(initialPoint.x)), String(Math.round(initialPoint.y))]);
    await agentBrowser(binary!, env, ["mouse", "down", "left"]);
    await agentBrowser(binary!, env, ["mouse", "move", String(Math.round(initialPoint.x + 30)), String(Math.round(initialPoint.y + 30))]);
    await agentBrowser(binary!, env, ["mouse", "up", "left"]);
    await expect.poll(async () => (await api("GET", "/api/team-map/layout")).layout.positions.Engineering.x).not.toBe(initialX);
    const draggedLeft = await evaluate("document.querySelector('[data-team-key=Engineering]').style.left");
    await new Promise((resolve) => setTimeout(resolve, 11000));
    expect(await evaluate("document.querySelector('[data-team-key=Engineering]').style.left")).toBe(draggedLeft);
    await evaluate("document.querySelector('[data-arrange-team=Engineering]').focus()");
    await agentBrowser(binary!, env, ["press", "Shift+ArrowRight"]);
    await expect.poll(async () => (await api("GET", "/api/team-map/layout")).layout.positions.Engineering?.x).toBeTypeOf("number");
    const expectedLeft = await evaluate("document.querySelector('[data-team-key=Engineering]').style.left");
    const secondEnv = sessionEnv({ home: fixture.info.dataDir, session: "map-preview-second-device", chrome: CHROME! });
    try {
      await agentBrowser(binary!, secondEnv, ["open", preview.previewUrl]);
      await expect.poll(async () => (await agentBrowser(binary!, secondEnv, ["eval", "document.querySelector('[data-team-key=Engineering]')?.style.left"])).result).toBe(expectedLeft);
      await expect.poll(async () => (await agentBrowser(binary!, secondEnv, ["eval", "document.querySelector('header button')?.getAttribute('aria-pressed')"])).result).toBe("false");
    } finally { await agentBrowser(binary!, secondEnv, ["close"]); }
    writeFileSync(join(evidence, "receipt.json"), JSON.stringify({ synthetic: true, liveBrowserPreviews: connections, hiddenStreams: stream.size, selectedBot: ids[0], screenshot: "live-browser-previews.png" }, null, 2));
  } finally {
    await agentBrowser(binary!, env, ["close"]).catch(() => {});
    await preview?.close();
    await real.close();
    if (bridge) { bridge.closeAllConnections(); await new Promise<void>((resolve) => bridge!.close(() => resolve())); }
    await pages.close(); await fixture.close();
  }
}, 120_000);
