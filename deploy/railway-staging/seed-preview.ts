import { existsSync, readdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { Store } from "../../server/store.ts";
import { ReplyDraftStore } from "../../server/reply/store.ts";
import { closeMessageDb } from "../../server/message-db.ts";
if(process.env.RAILWAY_SERVICE_ID!=="44625f97-bc43-4018-83c0-a726756d2879")throw new Error("Staging service required");
const dir=process.env.OMB_DATA_DIR!;
const marker=join(dir,".reply-composer-preview-v1");
if(!existsSync(marker)){
 const store=new Store(()=>({instanceId:"claude",model:"sonnet"}));
 const bot=store.createBot({name:"Reply composer preview",title:"Synthetic email and Slack drafts",description:"Preview only. No tasks started and no external messages sent."},{seedMessages:false});
 const drafts=new ReplyDraftStore(join(dir,"reply-drafts"));
 for(const channel of ["email","slack"] as const){
  const content=channel==="email"?{channel,from:"team@example.com",to:["client@example.com"],cc:[],bcc:[],subject:"Re: Screenshot review",text:"Thanks for flagging this. I’ll check the field mapping and follow up.",mailbox:"INBOX"}:{channel,frontDeskDraftId:"00000000-0000-4000-8000-000000000000",text:"Thanks for the screenshot. I’ll verify the mapping and report back in this thread."};
  const draft=drafts.create(bot.id,bot.threadId,content,channel==="slack"?{workspace:"Example workspace",channel:"support",thread:"Example thread",sender:"You",scope:"preview",hash:"preview"}:undefined,{sender:"Example client",sentAt:"Today",text:"The form answers are missing. Could you check the mapping?",interpretation:"This is synthetic example content. No real client messages have been read.",attachments:[]});
  const path=join(dir,"reply-drafts",draft.id+".json");const saved=JSON.parse(readFileSync(path,"utf8"));saved.preview=true;writeFileSync(path+".tmp",JSON.stringify(saved),{mode:0o600});renameSync(path+".tmp",path);
  store.appendMessage(bot.threadId,{role:"bot",kind:"widget",replyDraftId:draft.id,text:`${channel} composer preview`});
 }
 writeFileSync(marker,"Preview seeded\n",{mode:0o600});closeMessageDb();
 console.log("Synthetic composer previews added; sending disabled.");
}

const previewSignatures=join(dir,"reply-drafts");
if(existsSync(previewSignatures))for(const name of readdirSync(previewSignatures)){
 if(!name.endsWith(".json"))continue;
 const path=join(previewSignatures,name);const draft=JSON.parse(readFileSync(path,"utf8"));
 if(!draft.preview||draft.content?.channel!=="email"||draft.content.signature!==undefined)continue;
 draft.content.signature={text:"Alex Example\nClient Services · Example Company\nteam@example.com",html:'<table><tr><td><strong style="font-size:18px">EXAMPLE</strong></td><td><strong>Alex Example</strong><br>Client Services<br>Example Company<br><a href="mailto:team@example.com">team@example.com</a></td></tr></table>'};
 draft.revision++;writeFileSync(path+".tmp",JSON.stringify(draft),{mode:0o600});renameSync(path+".tmp",path);
}
