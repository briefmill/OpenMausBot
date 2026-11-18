import type { EmailProvider } from "../../shared/email-provider.ts";
import { z } from "zod";
import { replyContentSchema, type ReplyDraft, type EmailSignature } from "../../shared/reply-draft.ts";
import { ReplyDraftStore, replyHash } from "../reply/store.ts";
import { ownerOrAdmin, type RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";
const change=z.object({revision:z.number().int().positive(),content:replyContentSchema.optional(),discard:z.boolean().optional(),saveSignature:z.boolean().optional()}).strict();
const send=z.object({revision:z.number().int().positive(),hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export function createReplyDraftRoutes(deps:{store:ReplyDraftStore;provider?(from:string):EmailProvider;signature?(from:string):EmailSignature|undefined;saveSignature?(from:string,signature:EmailSignature):void;visible(auth:RequestAuth,botId:string,threadId:string):boolean;deliver(draft:ReplyDraft):Promise<NonNullable<ReplyDraft["receipt"]>>}):RouteHandler {
 return async ({path,method,auth,req,res,json,readBody})=>{
  const match=/^\/api\/reply-drafts\/([a-f0-9-]{36})(\/send)?$/.exec(path);if(!match)return PASS;
  res.setHeader("cache-control","private, no-store");
  // Sending is reserved to signed-in human devices, never a bot's internal capability or shared-host loopback.
  if(!ownerOrAdmin(auth)||(auth.kind==="session"&&auth.via==="ticket"))return json(res,403,{error:"An owner or admin device must review this reply."});
  try {
   let draft=deps.store.read(match[1]!);if(!deps.visible(auth,draft.botId,draft.threadId))return json(res,404,{error:"Draft not found"});
   const answer=(value:ReplyDraft)=>json(res,200,{draft:value,hash:replyHash(value),...(value.content.channel==="email"?{emailProvider:deps.provider?.(value.content.from)}:{})});
   if(method==="GET"&&!match[2]){
    if(draft.state==="draft"&&draft.content.channel==="email"&&draft.content.signature===undefined){const signature=deps.signature?.(draft.content.from);if(signature)draft=deps.store.edit(draft.id,draft.revision,{...draft.content,signature});}
    return answer(draft);
   }
   if(!String(req.headers["content-type"]??"").startsWith("application/json"))return json(res,415,{error:"Expected JSON"});
   if(method==="PATCH"&&!match[2]){const body=change.parse(await readBody(req,80_000));if(body.saveSignature&&draft.preview)return json(res,403,{error:"Synthetic previews cannot change mailbox defaults."});let content=body.content;
    if(content?.channel==="email"&&draft.content.channel==="email"&&content.from.toLowerCase()!==draft.content.from.toLowerCase())content={...content,signature:deps.signature?.(content.from)};
    if(body.saveSignature&&(!deps.saveSignature||content?.channel!=="email"||!content.signature))return json(res,400,{error:"Enter a signature for a connected sending account first."});
    const updated=deps.store.edit(draft.id,body.revision,content,body.discard);
    if(body.saveSignature&&updated.content.channel==="email"&&updated.content.signature)deps.saveSignature!(updated.content.from,updated.content.signature);
    return answer(updated);}
   if(method==="POST"&&match[2]){if(draft.preview)return json(res,403,{error:"This is a synthetic preview. Sending is disabled."});if(draft.content.channel==="social")return json(res,409,{error:"Social sending is not connected. Copy the reviewed reply and open the original message."});const body=send.parse(await readBody(req,1024));return answer(await deps.store.send(draft.id,body.revision,body.hash,deps.deliver));}
   return json(res,405,{error:"Method not allowed"});
  }catch(error){return json(res,error instanceof z.ZodError?400:(error as {status?:number}).status??500,{error:error instanceof z.ZodError?"Invalid reply fields":(error as Error).message});}
 };
}
