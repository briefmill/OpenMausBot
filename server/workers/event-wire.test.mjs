import test from 'node:test';
import assert from 'node:assert/strict';
import { workerEventForController } from './event-wire.mjs';
test('worker reply and terminal usage survive projection without protocol or tool arguments',()=>{
  const base={eventId:'event',threadId:'thread',turnId:'turn',provider:'fixture'};
  const reply=workerEventForController({...base,type:'item.completed',itemType:'assistant_text',text:'Scoped report',raw:{secret:'private'},commandLine:'private-command',input:{token:'private'}});
  assert.equal(reply.text,'Scoped report');assert.equal(reply.itemType,'assistant_text');
  assert.equal(JSON.stringify(reply).includes('private'),false);
  const terminal=workerEventForController({...base,type:'turn.completed',ok:true,cost:null,usage:{input:12,output:3,cachedInput:4}});
  assert.equal(terminal.cost,null);assert.deepEqual(terminal.usage,{input:12,output:3,cachedInput:4});
  assert.throws(()=>workerEventForController({...base,type:'turn.completed',cost:NaN}),/metric/);
  assert.throws(()=>workerEventForController({...base,type:'item.completed',itemType:'assistant_text',text:'x'.repeat(60001)}),/artifact/);
});
test('reasoning text and raw tool results are not included in reply projection',()=>{
  const reasoning=workerEventForController({type:'content.delta',streamKind:'reasoning_text',delta:'private'});
  assert.equal(reasoning.delta,undefined);
  const tool=workerEventForController({type:'item.completed',itemType:'tool',output:'private',input:{key:'private'}});
  assert.equal(tool.output,undefined);assert.equal(tool.input,undefined);
});
