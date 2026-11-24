import type { ReplyDraft } from "../../shared/reply-draft.ts";
import { ReplyNotSent } from "./store.ts";

type Request = (id:string, method:"GET"|"PATCH"|"POST", body?:unknown)=>Promise<Record<string,unknown>>;
function sameDestination(remote:Record<string,unknown>, destination:NonNullable<ReplyDraft["destination"]>) {
 return remote.team_id===destination.workspace&&remote.channel_id===destination.channel&&remote.sender_user_id===destination.sender&&remote.scope===destination.scope&&(remote.thread_ts??undefined)===destination.thread;
}
export async function deliverSlackReply(draft:ReplyDraft, request:Request, now=Date.now()) {
 if(draft.content.channel!=="slack"||!draft.destination)throw new ReplyNotSent("Slack destination is missing. Nothing was sent.");
 const content=draft.content,destination=draft.destination;
 let remote;
 try{remote=await request(content.frontDeskDraftId,"GET");}catch{throw new ReplyNotSent("Front Desk could not load this draft. Nothing was sent.");}
 if(!sameDestination(remote,destination)||remote.hash!==destination.hash||remote.state!=="pending"||typeof remote.expiresAt!=="number"||remote.expiresAt<=now)throw new ReplyNotSent("Slack draft expired, changed, or is no longer pending. Nothing was sent.");
 let hash=destination.hash;
 if(remote.text!==content.text){
  try{await request(content.frontDeskDraftId,"PATCH",{hash,text:content.text});remote=await request(content.frontDeskDraftId,"GET");}catch{throw new ReplyNotSent("Front Desk could not verify the edited reply. Nothing was sent.");}
  if(!sameDestination(remote,destination)||remote.text!==content.text||remote.state!=="pending"||typeof remote.hash!=="string"||!/^[a-f0-9]{64}$/.test(remote.hash)||typeof remote.expiresAt!=="number"||remote.expiresAt<=Date.now())throw new ReplyNotSent("Front Desk did not preserve the reviewed reply and destination. Nothing was sent.");
  hash=remote.hash;
 }
 const sent=await request(content.frontDeskDraftId,"POST",{hash});
 if(sent.state!=="sent"||typeof sent.ts!=="string"||!sent.ts)throw new Error("Slack delivery not confirmed");
 return {id:sent.ts};
}
