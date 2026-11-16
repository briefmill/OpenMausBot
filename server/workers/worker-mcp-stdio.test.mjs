import test from 'node:test';import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {serveWorkerMcp} from './worker-mcp-stdio.mjs';
const lease={id:'job',worker:'worker',generation:1,token:'synthetic'};
test('native MCP stdio preserves framing and never writes credentials or protocol input to output',async()=>{
  const input=new PassThrough(),output=new PassThrough(),chunks=[];let calls=0;
  output.on('data',chunk=>chunks.push(chunk));
  const serving=serveWorkerMcp({jobId:'job',lease,signal:AbortSignal.timeout(2000),input,output,
    client:{toolCatalog:async()=>({definitions:[{type:'function',function:{name:'read',description:'Synthetic',parameters:{type:'object'}}}]}),
      callTool:async()=>{calls++;return{result:{ok:true,text:'own report'}};}}});
  input.write('{"jsonrpc":"2.0","id":1,"method":"initial');
  input.write('ize"}\nnot-json\n');
  input.end(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'read',arguments:{}}})+'\n');
  await serving;
  const replies=Buffer.concat(chunks).toString().trim().split('\n').map(JSON.parse);
  assert.equal(replies.length,3);assert.equal(replies.find(row=>row.id===1).result.serverInfo.name,'mausbot-controller-tools');
  assert.equal(replies.find(row=>row.id===2).result.content[0].text,'own report');assert.equal(calls,1);
  assert.equal(JSON.stringify(replies).includes(lease.token),false);
});
test('oversized unterminated input stops the MCP stream before dispatch',async()=>{
  const input=new PassThrough(),output=new PassThrough();let calls=0;
  const serving=serveWorkerMcp({jobId:'job',lease,signal:AbortSignal.timeout(2000),input,output,
    client:{toolCatalog:async()=>{calls++;return{definitions:[]};},callTool:async()=>{calls++;}}});
  input.end('x'.repeat(1024*1024+1));
  await assert.rejects(serving,/frame budget/);assert.equal(calls,0);
});
