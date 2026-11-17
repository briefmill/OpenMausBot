import test from 'node:test';import assert from 'node:assert/strict';
import {createWorkerBrowserTransport} from './browser-mcp-transport.mjs';
const job={id:'job',worker:'worker',generation:1},lease={...job,token:'synthetic-token',deadline:Date.now()+60000};
const tool={name:'agent_browser_click',inputSchema:{type:'object'}};
function fixture(){let active=true,fail=false;const calls=[];
  const transport=createWorkerBrowserTransport({job,lease,client:{browser:async args=>{calls.push(args);if(fail)throw Error('secret connection error');return args.operation.method==='tools/list'?{tools:[tool]}:{content:[]};}},isCurrent:()=>active});
  return{transport,calls,revoke:()=>{active=false;},fail:()=>{fail=true;}};
}
const signal=()=>AbortSignal.timeout(2000);
test('browser mount initializes once and forwards only pinned lease calls',async()=>{
  const f=fixture();assert.deepEqual(await f.transport.tools(signal()),[tool]);await f.transport.tools(signal());assert.equal(f.calls.length,2);
  await f.transport.call('tools/call',{name:tool.name,arguments:{ref:'e1'}},signal());assert.equal(f.calls.length,3);
  for(const call of f.calls)assert.deepEqual(call.lease,lease);
  assert.equal(new Set(f.calls.map(call=>call.operation.id)).size,3);
  await f.transport.close();await assert.rejects(f.transport.tools(signal()),/unavailable/);assert.equal(f.calls.length,3);
});
test('revoked and foreign browser bindings cannot dispatch',async()=>{
  assert.throws(()=>createWorkerBrowserTransport({job,lease:{...lease,worker:'foreign'},client:{browser(){}},isCurrent:()=>true}),/binding/);
  const f=fixture();await f.transport.tools(signal());f.revoke();await assert.rejects(f.transport.call('tools/call',{name:tool.name,arguments:{}},signal()),/unavailable/);assert.equal(f.calls.length,2);
});
test('unknown browser outcomes poison the mount without leaking upstream details',async()=>{
  const f=fixture();await f.transport.tools(signal());f.fail();
  await assert.rejects(f.transport.call('tools/call',{name:tool.name,arguments:{}},signal()),error=>/reconciliation/.test(error.message)&&!error.message.includes('secret'));
  await assert.rejects(f.transport.call('tools/call',{name:tool.name,arguments:{}},signal()),/unavailable/);assert.equal(f.calls.length,3);
});
test('unlisted tools and alternate RPC methods never reach the browser',async()=>{
  const f=fixture();await f.transport.tools(signal());
  await assert.rejects(f.transport.call('tools/call',{name:'unlisted',arguments:{}},signal()),/unavailable/);
  await assert.rejects(f.transport.call('initialize',{},signal()),/unavailable/);assert.equal(f.calls.length,2);
});
