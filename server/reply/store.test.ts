import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReplyDraftStore, replyHash } from "./store.ts";
import { replyInboundSchema, type ReplyContent } from "../../shared/reply-draft.ts";
const dirs:string[]=[];
const fixture=()=>{const dir=mkdtempSync(join(tmpdir(),"reply-test-"));dirs.push(dir);return {dir,store:new ReplyDraftStore(dir)};};
const content:ReplyContent={channel:"email",from:"sender@example.com",to:["recipient@example.com"],cc:[],bcc:[],subject:"Reply",text:"Reviewed text",mailbox:"INBOX",replyToUid:42};
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
describe("reviewed replies",()=>{
 it("keeps inbound context and inspection claims separate from the outgoing message across restart",()=>{
  const {dir,store}=fixture();const inbound=replyInboundSchema.parse({sender:"Client",text:"See attached",interpretation:"Possible missing mapping",attachments:[{path:"/attachments/example.png",name:"Screenshot.png"}]});
  const draft=store.create("bot","thread",content,undefined,inbound);
  expect(new ReplyDraftStore(dir).read(draft.id).inbound).toEqual({...inbound,attachments:[{...inbound.attachments[0],inspected:false}]});
  expect(draft.content.text).toBe("Reviewed text");
  expect(replyInboundSchema.safeParse({...inbound,sourceUrl:"javascript:alert(1)"}).success).toBe(false);
 });
 it("prevents stale-device edits and a send against an old reviewed hash",async()=>{
  const {store}=fixture();const draft=store.create("bot","thread",content);const changed=store.edit(draft.id,1,{...content,text:"Edited"});
  expect(()=>store.edit(draft.id,1,content)).toThrow(/another device/);
  let calls=0;await expect(store.send(draft.id,changed.revision,replyHash(draft),async()=>{calls++;return{id:"x"};})).rejects.toThrow();expect(calls).toBe(0);
 });
 it("sends once even with simultaneous clicks and returns a receipt after a lost response",async()=>{
  const {store}=fixture();const draft=store.create("bot","thread",content);let finish!:(value:{id:string})=>void;let calls=0;
  const deliver=()=>{calls++;return new Promise<{id:string}>(resolve=>{finish=resolve;});};
  const pending=store.send(draft.id,1,replyHash(draft),deliver);
  await expect(store.send(draft.id,1,replyHash(draft),deliver)).rejects.toThrow();
  finish({id:"provider-receipt"});expect((await pending).state).toBe("sent");
  expect((await store.send(draft.id,1,replyHash(draft),deliver)).receipt?.id).toBe("provider-receipt");expect(calls).toBe(1);
 });
 it("does not resend uncertain delivery after failure or restart",async()=>{
  const {dir,store}=fixture();const draft=store.create("bot","thread",content);
  const result=await store.send(draft.id,1,replyHash(draft),async()=>{throw new Error("timeout");});expect(result.state).toBe("delivery_unknown");
  await expect(new ReplyDraftStore(dir).send(draft.id,result.revision,replyHash(draft),async()=>({id:"duplicate"}))).rejects.toThrow();
 });
 it("marks interrupted sending as unknown on recovery",async()=>{
  const {dir,store}=fixture();const draft=store.create("bot","thread",content);let finish!:(value:{id:string})=>void;
  const pending=store.send(draft.id,1,replyHash(draft),()=>new Promise(resolve=>{finish=resolve;}));
  expect(store.read(draft.id).state).toBe("sending");expect(new ReplyDraftStore(dir).read(draft.id).state).toBe("delivery_unknown");finish({id:"done"});await pending;
 });
});
