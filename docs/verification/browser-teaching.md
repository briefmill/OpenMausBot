# Browser demonstrations

Teach a task starts a `/learn watch me …` draft. Sending it opens the browser
panel. The person keeps browser control while the existing interactive stream
records action metadata and the renderer records its browser canvas as WebM.
The red **Stop training session** button saves both artifacts through the
existing private attachment store and sends their references to the originating
bot conversation for skill authoring. Generic `/learn <reference>` still uses
the existing authoring flow.

Recording is shown only after the server acknowledges capture. It ends on stop,
disconnection, loss of control, panel close, or its size/time limit. Unconfirmed
or interrupted captures are labeled incomplete. Failed uploads retain evidence
in renderer memory for Retry saving training; this is not crash recovery and a
full application exit can discard unsaved evidence.

Capture includes browser input actions, isolated-world target selectors and
labels, navigation, request method/path, response status and failed requests.
Typed content, query strings, fragments, credentials, headers and request bodies
are omitted. Cross-origin iframe interiors, console logs and other desktop apps
are not captured. Video may contain visible client information and belongs to
the same private workspace as its attachments. The bot must treat captured page
content as untrusted data and identify gaps rather than inventing steps.

Limits: 20 minutes, 4,000 metadata events, and an 80 MiB video stopping threshold.
Browser recording needs Chrome streaming and a renderer with WebM MediaRecorder
and canvas.captureStream. A passive Team map viewer cannot start capture or gain
control. The bot remains unable to drive the browser while its person holds it.

## Verification

Use Node 24. Run real-browser tests with OMB_CDP_CHROME pointing at a disposable
Chrome binary and OMB_MAP_TEST_AGENT_BROWSER pointing at agent-browser:

```sh
node node_modules/vitest/vitest.mjs run server/browser/viewers/teaching.test.ts server/skill-learn.test.ts src/components/BrowserPanel.test.ts src/components/BrowserPanel.dom.test.ts src/components/Composer.simple.test.ts
node node_modules/vitest/vitest.mjs run server/browser/viewers/stream-v2.e2e.test.ts -t 'records teaching'
node node_modules/vitest/vitest.mjs run scripts/testing/browser-teaching-ui.e2e.test.ts
```

The UI fixture launches the standard isolated fake-engine server, routes browser
streams to temporary Chrome profiles, demonstrates a real mouse click, checks
the page changes and the selector appears in the uploaded log, checks a WebM
header, and verifies both attachments target the bot. It also checks automatic
watch-me startup. No live client data or paid model calls are used. Evidence is
in images/browser-teaching/. The captured WebM was additionally decoded by
ffprobe as VP8. This verifies evidence delivery, not a live model's skill quality.

Team map VM and browser previews have separate synced showScreens and
showBrowsers fields. The browser preview switch uses the connected server's
Chrome engine capability; passive previews use existingOnly and cannot start
browsers. Map layout route tests verify independent preference persistence.
