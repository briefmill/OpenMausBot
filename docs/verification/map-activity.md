# Team map Activity lists

The header's Activity button opens three lists: Active bots, Active desktops, and Active browsers. Bot rows distinguish working from waiting for approval. Desktop rows include starting, working, and ready machines; sleeping, off, and problem machines remain in Manage desktops. Existing desktop management is preserved.

The browser list uses the browser host's running check for each visible bot's visible main conversation. It does not infer browser activity from bot activity or start a browser to populate the list. It does not enumerate other conversations' private browser sessions. An older server without the new projection shows an unavailable message. The desktop inventory continues refreshing while Activity is open even if map previews are hidden.

Verification:

- `tsc -b` and the custom renderer production build passed.
- `tsc -p tsconfig.server.build.json --noEmit` checks production server source.
- `server/team-map-api.test.ts` runs a fake-engine handoff and verifies busy bots without browsers do not appear as active browsers.
- `scripts/testing/map-activity-ui.e2e.test.ts` launches an isolated fixture, checks filtering of busy/waiting/idle/hidden bots, active/sleeping desktops, and an independently running browser, then checks all three open callbacks.
- The exact preserved deployment bundle is checked with the packaged-server smoke fixture, including a disposable bot and `/api/team-map` response.

No client records, live workflows, or external messages are used by these checks.
