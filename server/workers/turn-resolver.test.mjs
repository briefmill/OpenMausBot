import test from 'node:test';import assert from 'node:assert/strict';
import {resolveOwnedWorkerTurn} from './turn-resolver.mjs';
const base={botId:'b',threadId:'t',ownerBotId:'b',busy:true,claim:{id:'g',botId:'b',threadId:'t',phase:'dispatching'},request:{generation:'g'}};
test('live delegated ownership works without a user message while person requests retain their identity',()=>{
 assert.deepEqual(resolveOwnedWorkerTurn(base),{bot:'b',thread:'t',requestId:'g',active:true});
 assert.equal(resolveOwnedWorkerTurn({...base,request:{generation:'g',messageId:'user-request'}}).requestId,'user-request');
});
test('foreign stopped stale setup and idle claims cannot admit worker turns',()=>{
 for(const change of [{ownerBotId:'foreign'},{busy:false},{claim:{...base.claim,botId:'foreign'}},{claim:{...base.claim,threadId:'foreign'}},{claim:{...base.claim,phase:'setup'}},{request:{generation:'old'}},{request:{generation:'g',stopped:true}},{claim:undefined},{request:undefined}])assert.equal(resolveOwnedWorkerTurn({...base,...change}).active,false);
});
