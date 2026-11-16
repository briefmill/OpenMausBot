# Live browser previews on the Team map

Based on upstream v0.1.161. This feature extends the existing Show screens control. Browser previews reuse ComputerNode, the VM monitor dimensions, teamGeometry and connecting lines. A bot can have its VM and browser drawn side by side.

Each enabled browser has a monitor. While its bot is busy, and its monitor and the app are visible, the monitor opens the existing authenticated v2 browser stream as a passive, existing-only viewer. It follows the bot's selected conversation scope and profile. It does not send page input or a viewport size. Clicking opens that bot's existing computer panel on Browser.

The server forces existing-only connections to be passive, uses lower-paced frames capped by this viewer at 512 × 320, and does not attach to an absent, stopped or disconnected browser. Sign-in prompts stay in the full browser panel. No browser pixels are added to the general event stream. Existing viewer authorization, current-session checks and private-control masking still apply.

## Verification

Use Node 24 or later. Install locked dependencies, then run:

```sh
pnpm exec vitest run src/components/BrowserMapNode.test.ts src/lib/team-canvas-computers.test.ts src/lib/browser-stream-client.test.ts server/browser/service.test.ts
pnpm exec tsc -b
pnpm exec tsc -p tsconfig.server.json
pnpm exec vite build
```

For real Chrome, set OMB_CDP_CHROME to a Chrome for Testing executable. All browser profiles, pages and engine data are disposable. Nothing uses the person's live workspace or browser profile.

```sh
pnpm exec vitest run server/browser/viewers/stream-v2.e2e.test.ts -t 'passive map preview'
```

For the Team canvas UI fixture, also set OMB_MAP_TEST_AGENT_BROWSER to the pinned agent-browser executable (the installed desktop app's resources/browser-engine/agent-browser is suitable). The fixture launches the repository's fake-engine server and two real temporary Chrome browsers. It verifies the real canvas renderer, selected-bot callback, and stream cleanup when screens are hidden. The screenshot contains synthetic pages only.

```sh
pnpm exec vitest run scripts/testing/team-map-browsers-ui.e2e.test.ts
```

Evidence: [Midnight with previews](images/team-map-browsers/live-browser-previews.png), [Midnight screens hidden](images/team-map-browsers/midnight-before.png), [Daylight with previews](images/team-map-browsers/daylight-after.png), [Daylight screens hidden](images/team-map-browsers/daylight-before.png), [Live preview video](images/team-map-browsers/live-browser-previews.webm), [UI receipt](images/team-map-browsers/receipt.json).

## Scope and limits

- The first version supports the Chrome/v2 engine, not the legacy agent-browser/v1 viewer.
- Idle bots show a paused placeholder. Busy bots with no running browser show a waiting placeholder; watching never provisions a browser.
- It follows the bot's selected conversation, not every concurrent private conversation or every browser on the host.
- Existing server viewer limits remain: 16 total, four per profile. Excess connections use the existing reconnect behavior. A shared thumbnail aggregator or fairness scheduler is future work for large teams.
- The UI integration fixture uses the actual TeamCanvas and ComputerNode with a synthetic header and selected-bot callback. Full-panel input behavior continues to use the existing viewer; real Windows desktop acceptance has not been run.
- Server and renderer changes must ship together. This branch has not been deployed to Railway or installed over the user's patched desktop app.
