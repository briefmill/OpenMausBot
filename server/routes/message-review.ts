import { ownerOrAdmin } from "../request-auth.ts";
import { PASS } from "./table.ts";
import type { RouteHandler } from "./table.ts";

const ORIGIN = "https://watcher-production-86cc.up.railway.app";
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Review Slack message</title></head><body style="background:#171717;color:#eee;font:16px system-ui;max-width:760px;margin:40px auto;padding:20px"><h1>Review Slack message</h1><p id="destination"></p><pre id="text" style="white-space:pre-wrap;padding:20px;border:1px solid #777"></pre><p id="status">Loading draft...</p><button id="send" disabled>Approve and send exact message</button><script>
const id=new URLSearchParams(location.search).get('id');let draft;const status=document.getElementById('status'),button=document.getElementById('send');
const endpoint='/api/workspace/message-draft?id='+encodeURIComponent(id||'');
fetch(endpoint,{credentials:'same-origin'}).then(async r=>{if(!r.ok)throw Error('Cannot load draft');draft=await r.json();document.getElementById('destination').textContent='Sender '+draft.sender_user_id+' / workspace '+draft.team_id+' / channel '+draft.channel_id+(draft.thread_ts?' / thread '+draft.thread_ts:'');document.getElementById('text').textContent=draft.text;status.textContent='Status: '+draft.state;button.disabled=draft.state!=='pending'||draft.expiresAt<=Date.now();}).catch(e=>status.textContent=e.message);
button.onclick=async()=>{button.disabled=true;try{const r=await fetch(endpoint,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({hash:draft.hash})});const result=await r.json();if(!r.ok)throw Error(result.error||'Send not confirmed');status.textContent='Status: '+result.state;}catch(e){status.textContent=e.message+' Refresh to inspect status before doing anything else.';}};
</script></body></html>`;
export function createMessageReviewRoutes(deps: { key(): string | undefined; fetch?: typeof fetch }): RouteHandler {
 return async ({auth,req,res,path,method,url,json,readBody}) => {
  if(path!=="/api/workspace/message-review"&&path!=="/api/workspace/message-draft")return PASS;
  res.setHeader("cache-control","private, no-store");
  if(auth.kind!=="session" || auth.via!=="cookie" || !ownerOrAdmin(auth))return json(res,403,{error:"Workspace admin access required."});
  if(path.endsWith("message-review")) {
   if(method!=="GET")return json(res,405,{error:"Use GET."});
   res.setHeader("content-type","text/html; charset=utf-8");res.setHeader("x-frame-options","DENY");res.end(PAGE);return;
  }
  const id=url.searchParams.get("id")??"";
  if(!/^[a-f0-9-]{36}$/.test(id))return json(res,400,{error:"Invalid draft."});
  if(method!=="GET"&&method!=="POST")return json(res,405,{error:"Use GET or POST."});
  const key=deps.key();if(!key)return json(res,503,{error:"Message approval connection is not configured."});
  let body: string|undefined;
  if(method==="POST") {
   const origin=req.headers.origin;
   if(!origin || origin!=="https://openmausbot-production-5fc3f5cb.up.railway.app")return json(res,403,{error:"Approve from the workspace review page."});
   const value=await readBody(req,1024) as {hash?:unknown};
   if(typeof value?.hash!=="string"||!/^[a-f0-9]{64}$/.test(value.hash))return json(res,400,{error:"Invalid approval."});
   body=JSON.stringify({hash:value.hash});
  }
  try {
   const response=await(deps.fetch??fetch)(ORIGIN+"/admin/message-drafts/"+id,{method,redirect:"error",headers:{authorization:"Bearer "+key,"content-type":"application/json"},body,signal:AbortSignal.timeout(15000)});
   const raw=await response.text();if(raw.length>16000)throw Error("Oversize");const draft=JSON.parse(raw);
   if(!response.ok)return json(res,response.status===409?409:502,{error:"Send not confirmed. Refresh the draft status before creating another message."});
   return json(res,200,draft);
  }catch{return json(res,502,{error:"Front Desk unavailable. Delivery may be uncertain; check draft status and Slack before retrying."});}
 };
}
const approvalKey=process.env.OMB_FRONTDESK_APPROVAL_KEY;
delete process.env.OMB_FRONTDESK_APPROVAL_KEY;
export const messageReviewRoutes=createMessageReviewRoutes({key:()=>approvalKey});

export async function frontDeskDraftRequest(id:string, method:"GET"|"PATCH"|"POST", body?:unknown):Promise<Record<string,unknown>> {
 if(!approvalKey)throw new Error("Front Desk reply approval is not configured on this server.");
 if(!/^[a-f0-9-]{36}$/.test(id))throw new Error("Invalid Front Desk draft.");
 const response=await fetch(ORIGIN+"/admin/message-drafts/"+id,{method,redirect:"error",headers:{authorization:"Bearer "+approvalKey,"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15_000)});
 const raw=await response.text();if(raw.length>20_000)throw new Error("Front Desk returned an oversized draft.");
 if(!response.ok)throw new Error("Front Desk could not confirm the reviewed reply. Check its status before retrying.");
 return JSON.parse(raw);
}
