import assert from "node:assert/strict";
import { join } from "node:path";
import { launchVerificationServer } from "../control-omb.ts";
import { fixtureApi, mountPreview } from "./preview-fixture.ts";
import { agentBrowser, sessionEnv } from "./control-omb-ui.ts";
import { ReplyDraftStore } from "../../server/reply/store.ts";
const fixture=await launchVerificationServer();let preview;
const binary="/home/locksley/Applications/OpenMausBot-0.1.161-patched/resources/browser-engine/agent-browser";
const env=sessionEnv({home:fixture.info.dataDir,session:"reply-composer-check",chrome:"/home/locksley/.cache/puppeteer/chrome/linux-156.0.8078.47/chrome-linux64/chrome"});
const browser=(...args:string[])=>agentBrowser(binary,env,args);
try {
 const api=fixtureApi(fixture.info.url);const {bot}=await api("POST","/api/bots",{name:"Composer fixture"});
 const store=new ReplyDraftStore(join(fixture.info.dataDir,"reply-drafts"));
 const draft=store.create(bot.id,bot.threadId,{channel:"email",from:"team@example.com",to:["client@example.com"],cc:[],bcc:[],subject:"Re: Screenshot review",text:"Thanks. I’ll check the field mapping and report back.",mailbox:"INBOX"},undefined,{sender:"Example client",sentAt:"Today 10:13 AM",text:"The form answers are missing. Can you check the attached screenshot?",interpretation:"The client may be reporting missing field mapping. That needs verification.",attachments:[]});
 preview=await mountPreview(fixture,{entry:"/scripts/testing/reply-composer-preview.tsx",route:"/reply-preview",title:"Reply composer fixture"});
 await browser("open",`${preview.previewUrl}?draft=${draft.id}`);
 await browser("wait","--text","Inbound message");
 const first=await browser("snapshot","-i");console.log(JSON.stringify(first));
 await browser("click","button[aria-label='Sidebar threads']");
 const preference=await browser("eval","localStorage.getItem('omb-show-threads')");assert.ok(JSON.stringify(preference).includes("0"));
 await browser("fill","textarea[aria-label='Reply message']","Human edited reply.");
 await browser("click","@e11");
 await browser("wait","--text","Draft saved");
 assert.equal(store.read(draft.id).content.text,"Human edited reply.");
 await browser("eval","window.scrollTo(0,0)");
 await browser("screenshot","/tmp/reply-composer-preview.png","--full");
 console.log("PASS: isolated server startup, inbound context renders, editable reply saves to durable server draft.");
} finally {await browser("close").catch(()=>{});await preview?.close();await fixture.close();}
