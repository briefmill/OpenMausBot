# Windows continuation — 17 November 2026

Repository: https://github.com/briefmill/OpenMausBot
Branch: `codex/browser-teach-recorder`
Base PR: https://github.com/briefmill/OpenMausBot/pull/4 (`codex/team-map-layout-sync`).
This branch contains all completed work from this continuation and is stacked on that base PR. Do not merge or deploy unreviewed upstream updates as part of resuming this task.

## Completed and verified

- Browser demonstrations record browser actions, safe network metadata and video, with a red Stop training session control. See `docs/verification/browser-teaching.md` for limits and tests.
- Separate synchronized VM/browser visibility controls and distinct VM/browser card badges.
- Activity lists for active bots, desktops and browsers. Each active browser has a passive live preview in the list; running desktops use the existing shared screen-frame feed.
- Canvas browser cards capture a small thumbnail and disconnect, refreshing every 15 seconds while visible. Desktop canvas thumbnails refresh separately from the faster Activity feed.
- Closing/switching away from the live list disconnects browser streams; offscreen rows stop streaming. Browser previews are existing-only and do not take control or start browsers.
- Real isolated Chrome tests verify changing live frames, zero thumbnail viewer connections after capture, no extra browser profiles, and cleanup. Desktop-image fixture and cross-device map-layout checks passed. Custom renderer build and client typecheck passed.
- User confirmed the live Active browsers panel on the hosted app is exactly the desired result.

Railway production deployment: `1b5d4691-5722-4a57-a414-0f1d9721739b` (SUCCESS).
URL: https://openmausbot-production-5fc3f5cb.up.railway.app/
Service: `49381fa6-7f73-4936-a833-0c381c3909ce`; project: `3ee44c9c-e91f-47b2-a84f-171bf5a3fd0f`.
Live renderer bytes and health were verified. This last deployment changed only the renderer; the qualified server runtime was preserved.
Fedora's renderer was also installed with a backup. No new Windows desktop installer was built in this session.

## Next bug — voice input disappears during a running turn (NOT FIXED)

User report: while a bot is thinking/working, the voice-note/dictation button sometimes disappears. The user cannot record and queue a follow-up while the bot continues its current work. Screenshot supplied in the conversation on 17 November; do not upload that private client screenshot to the repository.

Expected behavior:

- Keep voice recording/dictation accessible during a running turn when input is otherwise permitted.
- Let the user review/edit the captured message and queue it in the current bot/conversation without stopping the running turn.
- Keep Stop, Send/Queue and voice-call controls distinguishable and usable in narrow layouts.
- Preserve legitimate input locks, approval gates, attachment handling and existing queue/steering behavior.
- Starting a recording must never send a message or stop a turn automatically.

Additional screenshot confirms the problem while BVS Tasks shows “Thinking it through”: the composer shows Stop and voice-call controls but no dictation microphone. An earlier bubble is labeled “sent mid-turn”; that proves some steering occurred earlier, not that the user can currently queue a message. Treat queued follow-up and immediate steering as separate choices. Ensure the queue action is discoverable during work and does not require stopping the turn. This is both a voice-input availability and queue discoverability report; do not assume removing the microphone's busy guard fixes the entire problem.

Investigation lead: `src/components/Composer.tsx` currently renders the dictation microphone under `!locked && !busy && micReady` near the composer action buttons. That busy guard is a plausible cause, not a complete diagnosis. The custom installed composer also contains voice/dictation modifications; inspect that version before fixing.

Reproduce with an isolated fake-engine turn held on a gate. Confirm the mic remains visible during work, dictation can produce a reviewable draft, queuing targets the same conversation, and the active turn is not interrupted. Cover desktop/compact layout, unavailable mic, cancellation and permission/locked states. The user asked to SAVE this bug for later, not to rush an untested fix before leaving work.

## Resume safely on Windows

```powershell
git clone https://github.com/briefmill/OpenMausBot.git
cd OpenMausBot
git fetch origin
git switch --track origin/codex/browser-teach-recorder
```

If the checkout already exists, inspect status first, then fetch and switch without discarding local edits. Read `AGENTS.md`, `DESIGN.md` and `docs/verification/README.md` before changing the app.

The user's complete custom app source was supplied separately as `mausbot-custom-source-2026-11-16.zip`. On Fedora it lives at `/home/locksley/Documents/ChatGPT/OpenMausBot/setup/custom-source-2026-11-16/mausbot-custom-source-2026-11-16/app`. Builds were merged into that custom source to preserve Brain, element annotations, dictation and approval changes. This feature branch is the portable feature patch history; do not assume it contains every earlier customization from that separate archive. Reconcile the Windows custom source before building an installer.

Qualified Railway deployment files are local to the Fedora workspace under `deployment/railway-browser-teaching`; they are not committed in this source PR. Preserve the current production wrapper/mailbox/access adapters. Do not replace the entire runtime with a generic build or old preload wrapper. Never copy tokens, local chat data, private screenshots or environment files into GitHub.

No client messages were sent and no client workflows/settings were changed for this UI work.
