import test from 'node:test';import assert from 'node:assert/strict';
import {resolveOwnedWorkerTurn} from './turn-resolver.mjs';
const base={botId:'b',threadId:'t',ownerBotId:'b',busy:true,claim:{id:'g',botId:'b',threadId:'t',phase:'dispatching'},request:{generation:'g'}};
test('live delegated ownership works without a user message and each dispatch has its own execution identity',()=>{
 assert.deepEqual(resolveOwnedWorkerTurn(base),{bot:'b',thread:'t',requestId:'g',active:true});
 assert.equal(resolveOwnedWorkerTurn({...base,request:{generation:'g',messageId:'user-request'}}).requestId,'g');
});
test('foreign stopped stale setup and idle claims cannot admit worker turns',()=>{
 for(const change of [{ownerBotId:'foreign'},{busy:false},{claim:{...base.claim,botId:'foreign'}},{claim:{...base.claim,threadId:'foreign'}},{claim:{...base.claim,phase:'setup'}},{request:{generation:'old'}},{request:{generation:'g',stopped:true}},{claim:undefined},{request:undefined}])assert.equal(resolveOwnedWorkerTurn({...base,...change}).active,false);
});

test('a resumed turn under the same person request gets a distinct execution identity',()=>{
 const first=resolveOwnedWorkerTurn({...base,request:{generation:'g',messageId:'same-request'}});
 const next=resolveOwnedWorkerTurn({...base,claim:{...base.claim,id:'next'},request:{generation:'next',messageId:'same-request'}});
 assert.equal(first.active,true);assert.equal(next.active,true);assert.notEqual(first.requestId,next.requestId);
 assert.deepEqual(resolveOwnedWorkerTurn({...base,request:{generation:'g',messageId:'same-request'}}),first);
});
