import test from 'node:test';import assert from 'node:assert/strict';
import {createLazyToolSession} from './lazy-tool-session.mjs';
function fixture(){let opened=0,closed=0,current=true,release;
  const session={definitions:()=>['catalog'],authorize:async()=>true,dispatch:async()=>({ok:true}),hasRequest:id=>id==='ask',respondToRequest:()=> 'allowed-once',close:async()=>{closed++;}};
  const lazy=createLazyToolSession({signal:AbortSignal.timeout(2000),isCurrent:()=>current,open:async()=>{opened++;if(release)await release;return session;}});
  return{lazy,opened:()=>opened,closed:()=>closed,revoke:()=>{current=false;},gate:promise=>{release=promise;}};
}
test('lazy tools mount once on first catalog access and preserve request routing',async()=>{
  const f=fixture();assert.equal(f.opened(),0);assert.equal(f.lazy.hasRequest('ask'),false);
  assert.deepEqual(await Promise.all([f.lazy.definitions(),f.lazy.definitions()]),[['catalog'],['catalog']]);assert.equal(f.opened(),1);
  assert.equal(f.lazy.hasRequest('ask'),true);assert.equal(f.lazy.respondToRequest('thread','ask',{}),'allowed-once');
  await f.lazy.close();await f.lazy.close();assert.equal(f.closed(),1);assert.equal(f.lazy.hasRequest('ask'),false);
});
test('closing unused tools never starts a browser',async()=>{const f=fixture();await f.lazy.close();assert.equal(f.opened(),0);await assert.rejects(f.lazy.definitions(),/current/);});
test('revocation during mount closes the new session without publishing its catalog',async()=>{
  const f=fixture();let release;f.gate(new Promise(resolve=>{release=resolve;}));
  const waiting=f.lazy.definitions();await Promise.resolve();f.revoke();release();
  await assert.rejects(waiting,/current/);assert.equal(f.closed(),1);await f.lazy.close();assert.equal(f.closed(),1);
});
test('close waits for an in-flight mount and closes it once',async()=>{
  const f=fixture();let release;f.gate(new Promise(resolve=>{release=resolve;}));
  const waiting=f.lazy.definitions();await Promise.resolve();const closing=f.lazy.close();release();
  await assert.rejects(waiting,/current/);await closing;assert.equal(f.closed(),1);
});
