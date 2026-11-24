import { expect, it, vi } from "vitest";
import type { ReplyDraft } from "../../shared/reply-draft.ts";
import { deliverSlackReply } from "./slack-delivery.ts";
import { ReplyNotSent } from "./store.ts";
const hash="a".repeat(64),editedHash="b".repeat(64);
const draft={id:"local",content:{channel:"slack",frontDeskDraftId:"remote",text:"Reviewed reply"},destination:{workspace:"team",channel:"channel",thread:"123",sender:"person",scope:"scope",hash}} as ReplyDraft;
const pending=()=>({team_id:"team",channel_id:"channel",thread_ts:"123",sender_user_id:"person",scope:"scope",hash,state:"pending",expiresAt:Date.now()+60_000,text:"Reviewed reply"});
it("sends the exact reviewed destination and returns the provider receipt",async()=>{
 const request=vi.fn().mockResolvedValueOnce(pending()).mockResolvedValueOnce({state:"sent",ts:"456"});
 await expect(deliverSlackReply(draft,request)).resolves.toEqual({id:"456"});
 expect(request.mock.calls).toEqual([["remote","GET"],["remote","POST",{hash}]]);
});
it.each([{thread_ts:"other"},{scope:"other"},{state:"sent"},{expiresAt:0},{hash:"changed"}])("does not send stale or redirected drafts: %j",async change=>{
 const request=vi.fn().mockResolvedValue({...pending(),...change});
 await expect(deliverSlackReply(draft,request)).rejects.toBeInstanceOf(ReplyNotSent);
 expect(request).toHaveBeenCalledTimes(1);
});
it("reads an edited draft back before sending its new hash",async()=>{
 const request=vi.fn().mockResolvedValueOnce({...pending(),text:"Old reply"}).mockResolvedValueOnce({hash:editedHash}).mockResolvedValueOnce({...pending(),hash:editedHash}).mockResolvedValueOnce({state:"sent",ts:"456"});
 await deliverSlackReply(draft,request);
 expect(request.mock.calls.map(call=>call[1])).toEqual(["GET","PATCH","GET","POST"]);
 expect(request.mock.calls[3]?.[2]).toEqual({hash:editedHash});
});
it("does not send when edited content was not saved",async()=>{
 const request=vi.fn().mockResolvedValueOnce({...pending(),text:"Old reply"}).mockResolvedValueOnce({hash:editedHash}).mockResolvedValueOnce({...pending(),text:"Wrong reply",hash:editedHash});
 await expect(deliverSlackReply(draft,request)).rejects.toBeInstanceOf(ReplyNotSent);
 expect(request.mock.calls.some(call=>call[1]==="POST")).toBe(false);
});
it("keeps uncertain send outcomes distinct from safe pre-send failures",async()=>{
 const request=vi.fn().mockResolvedValueOnce(pending()).mockRejectedValueOnce(new Error("Connection lost"));
 await expect(deliverSlackReply(draft,request)).rejects.not.toBeInstanceOf(ReplyNotSent);
});
