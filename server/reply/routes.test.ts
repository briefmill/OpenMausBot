import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RouteContext } from "../routes/table.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createReplyDraftRoutes } from "../routes/reply-drafts.ts";
import { ReplyDraftStore, replyHash } from "./store.ts";
const dirs:string[]=[];
afterEach(()=>dirs.splice(0).forEach(dir=>rmSync(dir,{recursive:true,force:true})));
it("only lets an owner review and send a visible draft, using exactly saved content",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"reply-route-"));dirs.push(dir);const store=new ReplyDraftStore(dir);
 const draft=store.create("bot","thread",{channel:"email",from:"owner@example.com",to:["client@example.com"],cc:[],bcc:[],subject:"Test",text:"Reviewed",mailbox:"INBOX"});
 let visible=true;const delivered:string[]=[];
 const route=createReplyDraftRoutes({store,visible:()=>visible,deliver:async draft=>{delivered.push(draft.content.text);return{id:"receipt"};}});
 async function request(auth:RequestAuth,method:string,body:unknown={},suffix=""){
  let answer:{status:number;body:any}|undefined;
  await route({path:`/api/reply-drafts/${draft.id}${suffix}`,method,auth,req:{headers:{"content-type":"application/json"}},res:{setHeader(){}},readBody:async()=>body,json:(_res:unknown,status:number,body:unknown)=>{answer={status,body};}} as unknown as RouteContext);
  return answer!;
 }
 const owner:RequestAuth={kind:"loopback",scopes:["admin","client"]};
 expect((await request({kind:"loopback",scopes:["client"],trust:"service"},"POST",{revision:1,hash:replyHash(draft)},"/send")).status).toBe(403);
 expect((await request({kind:"session",via:"ticket",scopes:["admin"],session:{} as never},"GET")).status).toBe(403);
 expect((await request({kind:"session",via:"bearer",scopes:["client"],session:{} as never},"GET")).status).toBe(403);
 visible=false;expect((await request(owner,"GET")).status).toBe(404);visible=true;
 expect(delivered).toEqual([]);
 const saved=await request(owner,"PATCH",{revision:1,content:{...draft.content,text:"Human edited"}});expect(saved.status).toBe(200);
 expect((await request(owner,"POST",{revision:1,hash:replyHash(draft)},"/send")).status).toBe(409);
 expect((await request(owner,"POST",{revision:saved.body.draft.revision,hash:saved.body.hash},"/send")).body.draft.state).toBe("sent");
 expect(delivered).toEqual(["Human edited"]);
});
