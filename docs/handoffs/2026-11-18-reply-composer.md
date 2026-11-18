# Reply composer and sidebar visibility

Branch: `codex/reply-composer`, based on `codex/staging-browser-verified` (7d0f544f8).

## Implemented

- Chat activity includes a Sidebar threads switch using the existing `omb-show-threads` preference. It hides bot expand arrows and nested thread lists without deleting threads. Choice persists per device/browser; it is not a server-synchronized preference.
- `prepare_reply` creates a durable inline email/Slack draft. Only owner/admin human-device routes can edit or send it; internal bot capabilities cannot call Send. Direct conversations only.
- Draft editing uses revisions. Sending binds the saved body, destination, and inbound context to a hash, claims sending synchronously, and refuses stale/concurrent requests. Uncertain delivery is locked against automatic retries, including interrupted sends recovered after restart.
- Optional inbound context contains a quoted message, sender/time/source link, attachments and a separate interpretation. Quotes and attachment inspection are explicitly bot-reported, not independently source-verified.
- Inbound files are copied through the existing bot workspace/inbox attachment guard and registered on the chat message. Existing authenticated image/file viewers handle previews; arbitrary remote attachment URLs are not fetched.

## Validation

142 targeted tests passed across reply storage/routes, agents call/catalog, thread preferences, sidebar rows, and chat automation. Client and server TypeScript checks passed before final production build. Isolated fake-engine server/browser check rendered inbound context, toggled and persisted Sidebar threads, and saved an edited reply. No real email or Slack messages were sent. Preview script uses only synthetic addresses/content.

## Remaining before rollout

- Front Desk must support compare-and-swap PATCH `/admin/message-drafts/:id` for edited Slack text, recomputing its hash while preserving scope/team/channel/thread/sender. The current older local Front Desk draft-admin module has GET/POST only; do not deploy that older checkout over newer production source. Until PATCH is available edited Slack sends report unsent and remain drafts.
- Native email sending uses the existing connected IMAP/SMTP email host and rechecks its policy; Gmail/Outlook MCP-only accounts need a separate adapter. No real mailbox delivery was qualified.
- Qualify the full active-turn tool → transcript card → source-file preview path and multi-device conflict UI before enabling bots to routinely prepare these cards. The browser fixture seeds a synthetic draft directly.
- Integrate the sidebar switch into the newest production Chat activity menu without dropping its Tool activity control; this branch starts from verified staging, while production has additional menu changes.
- No deployment, desktop installation, or production configuration changes were made in this implementation session.

## Commands

Use the repository-pinned Node runtime. Unit tests:

```sh
node node_modules/vitest/vitest.mjs run server/drivers/agents-catalog-wire.test.ts server/drivers/agents-call-cards.test.ts server/reply/store.test.ts server/reply/routes.test.ts src/lib/thread-preferences.test.ts src/components/SidebarBotListItem.test.ts src/components/SidebarBotListItem.expansion.test.ts src/components/ChatView.automation.test.ts
node --experimental-strip-types scripts/testing/verify-reply-composer.ts
```
