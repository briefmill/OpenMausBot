import { z } from "zod";
import { replyContentSchema, type ReplyDraft } from "../../shared/reply-draft.ts";
import { ReplyDraftStore, replyHash } from "../reply/store.ts";
import { ownerOrAdmin, type RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";
const change=z.object({revision:z.number().int().positive(),content:replyContentSchema.optional(),discard:z.boolean().optional()}).strict();
const send=z.object({revision:z.number().int().positive(),hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export function createReplyDraftRoutes(deps:{store:ReplyDraftStore;visible(auth:RequestAuth,botId:string,threadId:string):boolean;deliver(draft:ReplyDraft):Promise<NonNullable<ReplyDraft["receipt"]>>}):RouteHandler {
 return async ({path,method,auth,req,res,json,readBody})=>{
  const match=/^\/api\/reply-drafts\/([a-f0-9-]{36})(\/send)?$/.exec(path);if(!match)return PASS;
  res.setHeader("cache-control","private, no-store");
  // Sending is reserved to signed-in human devices, never a bot's internal capability or shared-host loopback.
  if(!ownerOrAdmin(auth)||(auth.kind==="session"&&auth.via==="ticket"))return json(res,403,{error:"An owner or admin device must review this reply."});
  try {
   const draft=deps.store.read(match[1]!);if(!deps.visible(auth,draft.botId,draft.threadId))return json(res,404,{error:"Draft not found"});
   const answer=(value:ReplyDraft)=>json(res,200,{draft:value,hash:replyHash(value)});
   if(method==="GET"&&!match[2])return answer(draft);
   if(!String(req.headers["content-type"]??"").startsWith("application/json"))return json(res,415,{error:"Expected JSON"});
   if(method==="PATCH"&&!match[2]){const body=change.parse(await readBody(req,80_000));return answer(deps.store.edit(draft.id,body.revision,body.content,body.discard));}
   if(method==="POST"&&match[2]){const body=send.parse(await readBody(req,1024));return answer(await deps.store.send(draft.id,body.revision,body.hash,deps.deliver));}
   return json(res,405,{error:"Method not allowed"});
  }catch(error){return json(res,error instanceof z.ZodError?400:(error as {status?:number}).status??500,{error:error instanceof z.ZodError?"Invalid reply fields":(error as Error).message});}
 };
}
