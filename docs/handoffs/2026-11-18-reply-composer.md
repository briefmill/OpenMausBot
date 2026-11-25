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
- Staging deployed on November 18: deployment `ba7b63f3-176a-4671-bf05-e1789f5e649b`, source `9669ca09d`. Public health passed and renderer entry asset matched the local build. The staging-only launcher seeds a Reply composer preview bot with synthetic email/Slack drafts; Send is disabled in the UI and rejected by the server for these drafts. Pairing codes are not stored in this document. Production was not deployed or reconfigured.

## Commands

Use the repository-pinned Node runtime. Unit tests:

```sh
node node_modules/vitest/vitest.mjs run server/drivers/agents-catalog-wire.test.ts server/drivers/agents-call-cards.test.ts server/reply/store.test.ts server/reply/routes.test.ts src/lib/thread-preferences.test.ts src/components/SidebarBotListItem.test.ts src/components/SidebarBotListItem.expansion.test.ts src/components/ChatView.automation.test.ts
node --experimental-strip-types scripts/testing/verify-reply-composer.ts
```

## Signature preview requirement (user feedback)

Display the sending account’s configured default reply signature below the editable reply body and above Discard/Save/Send, matching Grok Bot. Preserve its formatting, logo/photo and links; do not copy the external sender’s signature. Resolve it from the selected From account/alias, clear or reload it if From changes, and bind exactly the displayed signature into the reviewed send hash. Never synthesize a personal or business signature from memories.

This is not implemented yet. Native IMAP/SMTP accounts currently expose address/server/password settings, not provider signatures; Gmail MCP-only send and settings adapters also remain outstanding. The Gmail connector exposed to this Codex session has no signature/settings tool. A provider-specific authenticated signature lookup must be added before claiming automatic signature retrieval. If unavailable, show that explicitly; do not claim a signature was loaded. Preview rich HTML through the same bounded sanitizer used for outgoing HTML; never execute signature scripts or silently fetch arbitrary image URLs. Synthetic staging examples may use clearly labeled example signatures, but must remain unsendable.


## Signature preview implementation

The composer now renders a signature below the reply body and above Send. Paste a signature copied from mail settings to retain rich formatting, HTTPS images and links, or enter plain text. Saving as the account default stores it with that connected native mailbox in the encrypted email store. Defaults auto-populate new drafts and existing unsigned drafts. Changing From clears the previous signature and requires Save before Send so the new account signature can be reviewed. Bots cannot supply an invented signature during prepare_reply: the server uses the account default.

HTML is sanitized server-side using sanitize-html, previewed in a sandboxed CSP iframe, and included in outgoing multipart HTML with a plain-text alternative. The send hash includes the signature. A synthetic example is added only to existing unsendable staging preview email drafts.

Provider settings lookup is still unavailable: no Gmail/Outlook OAuth signature-settings adapter is wired. The UI explicitly says default signature unavailable until a signature is saved. Do not describe this as automatic retrieval from Gmail/Outlook. The earlier not-implemented note describes the provider lookup gap; local account default retrieval and signature preview/send are now implemented.


## Provider branding and composer palette
Gmail/Outlook headers use local provider logos. Native mailbox IMAP/SMTP metadata takes priority, including custom business domains; known public addresses are a fallback when server metadata is unavailable. Unknown mail providers keep the Mail envelope. Slack keeps its logo. Reply cards now use the requested charcoal background, lighter message surface, gray labels, and white Send button. The signature preview uses the same dark background. Styling is scoped to reply cards.

## Social cards and chat actions — Windows handoff

Branch: `codex/reply-composer`. Continue in draft PR #6: https://github.com/briefmill/OpenMausBot/pull/6. Do not replace the existing custom-source baseline. All renderer/server changes belong to this PR; production remains unchanged.

Reply composer cards now reuse the existing chat Reply, React, and Copy controls. Reply targets the card's message ID with the current reply text; Copy uses the current editor body (plus email signature text), not the placeholder widget label. Reactions use the normal persistent chat reaction endpoint and chips. These reactions are feedback in MausBot, not external social-platform reactions. Chat write restrictions still govern Reply/React; rooms stay read-only.

Social draft cards support Instagram, Facebook, Messenger, LinkedIn, X, YouTube, TikTok, and Threads with local platform logos. They carry inbound quote, interpretation and downloaded attachments through the existing copied-file pipeline, plus the displayed sending account, conversation, reply/comment type, original source link, and inbound message ID. Source links must use HTTPS on the selected platform. Editing can change reply text but cannot retarget the account/conversation/source message. Social source metadata is bot-reported, not remotely verified.

IMPORTANT REMAINING WORK: social delivery adapters/account authorization are not connected. Social Send is disabled in the UI and rejected server-side; Copy and Open original are available. Do not claim these cards send DMs/comments or react externally. Build per-platform authenticated adapters, validate that the connected account owns the immutable destination, bind provider state to the human-reviewed hash, then verify in a sandbox before enabling Send. Do not test against real contacts.

Staging seeding adds one clearly synthetic Instagram card to the existing composer preview chat, once, with sending disabled. New bundled helper must be built after every server build using `node deploy/railway-staging/build-preview.mjs`.

Provider signature settings import remains unfinished; current signatures use saved native-mailbox defaults or a user-pasted signature. Other earlier outstanding items, including busy-turn voice/message queue controls and browser teaching recorder, are not completed by this PR.

## November 24 follow-up

The composer is a shared reply surface for email, Slack and social messages. The body now blends with the card while idle and uses the lighter inset surface on hover or keyboard focus; disabled bodies stay dark. This change applies through the shared ReplyBody component.

Client build passed. The isolated composer fixture passed for rendered email/signature, compact editor sizing, durable edited drafts, and Instagram branding with unsupported social sending disabled. Targeted reply store/routes, Slack delivery and signature tests passed (25 tests); changed-file lint passed. No external messages were sent. This does not establish provider delivery or a staging deployment.

Gmail signature conversion now validates the exact sending alias and sanitizes provider HTML with a plain-text alternative. The authenticated settings lookup remains unwired. OAuth-only Gmail delivery and social delivery remain unfinished; do not describe the conversion helper or synthetic preview as a working connected provider.

Slack delivery now checks the pinned scope/workspace/channel/thread/sender, pending state, expiry, edited text readback and a real provider receipt. Local Front Desk source confirms scope/state/expiry/thread/receipt fields, but that older checkout lacks both sender_user_id and PATCH support. Verify the deployed Front Desk contract before claiming Slack composer delivery works. No production or staging deployment was performed in this follow-up.
