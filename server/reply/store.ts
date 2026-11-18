import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { replyInboundSchema, replyContentSchema, type ReplyContent, type ReplyDraft } from "../../shared/reply-draft.ts";
import { sanitizeReplyContent } from "./signature.ts";
export class ReplyNotSent extends Error {}
export class DraftConflict extends Error { status=409; }
export class ReplyDraftStore {
  private directory:string;
  private inFlight=new Set<string>();
  constructor(directory:string) { this.directory=directory; mkdirSync(directory,{recursive:true,mode:0o700}); }
  private path(id:string) { if(!/^[a-f0-9-]{36}$/.test(id)) throw Object.assign(new Error("Draft not found"),{status:404}); return join(this.directory,id+".json"); }
  private save(draft:ReplyDraft) { const file=this.path(draft.id),temp=file+"."+randomUUID()+".tmp";writeFileSync(temp,JSON.stringify(draft),{mode:0o600});renameSync(temp,file);return draft; }
  read(id:string):ReplyDraft { try {const draft:ReplyDraft=JSON.parse(readFileSync(this.path(id),"utf8"));if(draft.state==="sending"&&!this.inFlight.has(id)){draft.state="delivery_unknown";draft.revision++;draft.updatedAt=Date.now();this.save(draft);}return draft;}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")throw Object.assign(new Error("Draft not found"),{status:404});throw error;} }
  create(botId:string,threadId:string,content:ReplyContent,destination?:ReplyDraft["destination"],inbound?:ReplyDraft["inbound"]):ReplyDraft { const now=Date.now();return this.save({id:randomUUID(),botId,threadId,content:sanitizeReplyContent(replyContentSchema.parse(content)),destination,inbound:inbound?replyInboundSchema.parse(inbound):undefined,state:"draft",revision:1,createdAt:now,updatedAt:now}); }
  edit(id:string,revision:number,content?:ReplyContent,discard=false) {const draft=this.read(id);if(draft.revision!==revision||draft.state!=="draft")throw new DraftConflict("Draft changed on another device or is no longer editable. Reload it before continuing.");
    if(content){const parsed=replyContentSchema.parse(content);if(parsed.channel!==draft.content.channel)throw new DraftConflict("The delivery service cannot change.");if(parsed.channel==="social"&&draft.content.channel==="social"&&JSON.stringify({...parsed,text:""})!==JSON.stringify({...draft.content,text:""}))throw new DraftConflict("The social account and reply destination cannot change. Prepare a new draft.");if(parsed.channel==="slack"&&draft.content.channel==="slack"&&parsed.frontDeskDraftId!==draft.content.frontDeskDraftId)throw new DraftConflict("The Slack destination cannot change.");draft.content=sanitizeReplyContent(parsed);}
    draft.revision++;draft.updatedAt=Date.now();if(discard)draft.state="discarded";return this.save(draft);
  }
  async send(id:string,revision:number,hash:string,deliver:(draft:ReplyDraft)=>Promise<NonNullable<ReplyDraft["receipt"]>>) {
    const draft=this.read(id);
    if(draft.state==="sent"&&replyHash(draft)===hash)return draft;
    if(draft.revision!==revision||replyHash(draft)!==hash||draft.state!=="draft")throw new DraftConflict("Draft changed, is already sending, or needs delivery review. Nothing was sent by this request.");
    delete draft.deliveryError;draft.state="sending";draft.updatedAt=Date.now();this.save(draft);this.inFlight.add(id);
    try {draft.receipt=await deliver(structuredClone(draft));draft.state="sent";} catch(error) {draft.state=error instanceof ReplyNotSent?"draft":"delivery_unknown";if(error instanceof ReplyNotSent)draft.deliveryError=error.message;}
    draft.revision++;draft.updatedAt=Date.now();try{return this.save(draft);}finally{this.inFlight.delete(id);}
  }
}
/** Binds a human's send to all displayed editable content and its immutable destination. */
export function replyHash(draft:ReplyDraft) {return createHash("sha256").update(JSON.stringify({content:draft.content,destination:draft.destination,inbound:draft.inbound})).digest("hex");}
