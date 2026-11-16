import { expect,it,vi } from "vitest";
import { createMessageReviewRoutes } from "./message-review.ts";
import type { RouteContext } from "./table.ts";
const id="12345678-1234-1234-1234-123456789abc";
async function call(admin=true,method="GET",origin:string|undefined=undefined,hash="a".repeat(64),authOverride?:unknown) {
 let code=0;let body:unknown;const remote=vi.fn(async(_url:string,_init:RequestInit)=>Response.json({id,text:"Exact text",state:"pending"}));
 const handler=createMessageReviewRoutes({key:()=>"private-server-key",fetch:remote as typeof fetch});
 await handler({auth:authOverride??(admin?{kind:"session",via:"cookie",session:{},scopes:["admin"]}:{kind:"loopback",scopes:["client"],trust:"service"}),req:{headers:{origin}},res:{setHeader:vi.fn()},method,path:"/api/workspace/message-draft",url:new URL("http://localhost/api/workspace/message-draft?id="+id),json:(_r:unknown,c:number,b:unknown)=>{code=c;body=b;},readBody:async()=>({hash})} as unknown as RouteContext);
 return {code,body,remote};
}
it("rejects service callers before exposing drafts or sending",async()=>{for(const method of ["GET","POST"]){const r=await call(false,method);expect(r.code).toBe(403);expect(r.remote).not.toHaveBeenCalled();}});
it("reads through a fixed private server transport without leaking the approval key",async()=>{const r=await call();expect(r.code).toBe(200);expect(r.remote.mock.calls[0]?.[0]).toBe("https://watcher-production-86cc.up.railway.app/admin/message-drafts/"+id);expect(JSON.stringify(r.body)).not.toContain("private-server-key");});
it("requires hosted origin and exact hash before forwarding approval",async()=>{for(const origin of [undefined,"https://evil.invalid"]){const r=await call(true,"POST",origin);expect(r.code).toBe(403);expect(r.remote).not.toHaveBeenCalled();}const bad=await call(true,"POST","https://openmausbot-production-5fc3f5cb.up.railway.app","bad");expect(bad.code).toBe(400);const ok=await call(true,"POST","https://openmausbot-production-5fc3f5cb.up.railway.app");expect(ok.code).toBe(200);});

it("rejects admin bearer, stream tickets, member cookies and owner loopback",async()=>{for(const auth of [{kind:"session",via:"bearer",session:{},scopes:["admin"]},{kind:"session",via:"ticket",session:{},scopes:["admin"]},{kind:"session",via:"cookie",session:{},scopes:["client"]},{kind:"loopback",scopes:["admin","client"]}])for(const method of ["GET","POST"]){const r=await call(true,method,"https://openmausbot-production-5fc3f5cb.up.railway.app","a".repeat(64),auth);expect(r.code).toBe(403);expect(r.remote).not.toHaveBeenCalled();}});
