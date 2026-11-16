import test from 'node:test';import assert from 'node:assert/strict';
import {createWorkerMcpBridge} from './worker-mcp-bridge.mjs';
const lease={id:'job',worker:'worker',generation:1,token:'synthetic'};
const definition={type:'function',function:{name:'account_read',description:'Synthetic read',parameters:{type:'object'}}};
const request={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'account_read',arguments:{}}};
function fixture(overrides={}) {
  let calls=0;
  const bridge=createWorkerMcpBridge({jobId:'job',lease,signal:AbortSignal.timeout(2000),client:{
    toolCatalog:async()=>({definitions:[definition]}),callTool:async input=>{calls++;assert.equal(input.lease.id,'job');return{result:{ok:true,text:'own account'}};},...overrides}});
  return{bridge,calls:()=>calls};
}
test('MCP bridge advertises controller tools and returns one result for duplicate protocol requests',async()=>{
  const {bridge,calls}=fixture();
  const list=await bridge.handle({jsonrpc:'2.0',id:'list',method:'tools/list'});
  assert.deepEqual(list.result.tools,[{name:'account_read',description:'Synthetic read',inputSchema:{type:'object'}}]);
  const [first,second]=await Promise.all([bridge.handle(request),bridge.handle(request)]);
  assert.deepEqual(first,second);assert.equal(calls(),1);assert.equal(first.result.content[0].text,'own account');
  assert.equal((await bridge.handle({...request,params:{...request.params,arguments:{changed:true}}})).error.code,-32600);
});
test('unadvertised tools cannot dispatch and uncertain delivery poisons new calls',async()=>{
  let calls=0;
  const {bridge}=fixture({callTool:async()=>{calls++;throw Error('private credentials');}});
  assert.equal((await bridge.handle({...request,id:'foreign',params:{name:'unlisted',arguments:{}}})).error.code,-32602);
  assert.equal(calls,0);
  const failed=await bridge.handle(request);assert.equal(failed.error.code,-32000);
  assert.equal(JSON.stringify(failed).includes('private'),false);
  assert.equal((await bridge.handle({...request,id:2})).error.code,-32000);assert.equal(calls,1);
});
test('malformed and control-plane methods cannot escape the tool bridge',async()=>{
  const {bridge,calls}=fixture();
  assert.equal((await bridge.handle({})).error.code,-32600);
  assert.equal((await bridge.handle({...request,method:'finish'})).error.code,-32601);
  assert.equal((await bridge.handle({...request,params:{...request.params,endpoint:'foreign'}})).error.code,-32602);
  assert.equal(await bridge.handle({jsonrpc:'2.0',method:'notifications/initialized'}),undefined);
  assert.equal(calls(),0);
});
