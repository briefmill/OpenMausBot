import { expect, it } from "vitest";
import { emailReplyBody, sanitizeSignature } from "./signature.ts";
import { replyHash } from "./store.ts";
import type { ReplyDraft } from "../../shared/reply-draft.ts";

it("keeps signature formatting while removing active content and unsafe images", () => {
 const signature=sanitizeSignature({text:"My signature",html:'<script>alert(1)</script><strong>My signature</strong><img src="https://example.com/logo.png" onerror="alert(1)"><img src="http://localhost/private"><a href="javascript:alert(1)">bad</a><span style="background:url(https://example.com/track);color:#123456">Name</span>'});
 expect(signature.html).toContain("<strong>My signature</strong>");
 expect(signature.html).toContain('src="https://example.com/logo.png"');
 expect(signature.html).not.toMatch(/script|onerror|localhost|background|javascript|track/);
 expect(signature.html).toContain("color:#123456");
});

it("includes the reviewed signature in both outgoing body formats without treating reply text as HTML", () => {
 const body=emailReplyBody({channel:"email",from:"me@example.com",to:["you@example.com"],cc:[],bcc:[],subject:"Reply",text:"<hello> & welcome",mailbox:"INBOX",signature:{text:"My name",html:"<strong>My name</strong>"}});
 expect(body.text).toBe("<hello> & welcome\n\nMy name");
 expect(body.html).toContain("&lt;hello&gt; &amp; welcome");
 expect(body.html).toContain("<strong>My name</strong>");
});

it("binds signatures to the reviewed send hash", () => {
 const draft={content:{channel:"email",from:"me@example.com",to:["you@example.com"],cc:[],bcc:[],subject:"Reply",text:"Reply",mailbox:"INBOX",signature:{text:"First signature"}}} as ReplyDraft;
 const hash=replyHash(draft);
 if(draft.content.channel==="email")draft.content.signature={text:"Changed signature"};
 expect(replyHash(draft)).not.toBe(hash);
});
