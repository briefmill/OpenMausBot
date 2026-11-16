# Feature request: live browser previews beside bots in Team view

Team view already shows each bot's VM screen. Please extend the same Show screens feature to each bot's browser so we can watch agents working across websites without opening every chat.

I built and tested a prototype on v0.1.161 that reuses the VM monitor component, canvas geometry and connecting lines. A bot's VM and browser can appear side by side. The browser thumbnail is live while the bot is working and visible on the map. Clicking it opens the existing Browser panel.

The previews are passive: they cannot type, click, take control, resize the page, or start an absent browser. They stop when hidden or idle. Browser access stays on the existing authenticated, conversation-scoped stream.

Tests passed with temporary real Chrome browsers, including capped live frames, unchanged page size, refused input, no browser creation for missing sessions, and Team view stream cleanup. Screenshot attached uses synthetic demo pages, not client accounts.

Initial scope: Chrome/v2 browser engine. Windows desktop acceptance and scaling beyond the existing viewer limits are still follow-ups.

Screenshot: ../verification/images/team-map-browsers/live-browser-previews.png
