import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,dirname,basename } from 'node:path';
import { JobLedger } from './ledger.mjs';
import { bindWorkerUsage } from './usage-book.mjs';
test('terminal usage books once across reopen and preserves unknown cost',()=>{
  const home=mkdtempSync(join(tmpdir(),'omb-worker-usage-'));let ledger;
  try {
    const file=join(home,'jobs.db');ledger=new JobLedger(file);
    ledger.enqueue({id:'job',bot:'bot',thread:'thread',project:'project',resource:'desktop'});
    const lease=ledger.claim('job','worker',30000);
    const event={type:'turn.completed',threadId:'thread',turnId:'turn',usage:{input:12,output:3,cachedInput:4},cost:null};
    ledger.append(lease,1,event);
    let book=bindWorkerUsage({ledger,jobId:'job',generation:1,turnId:'turn'});
    assert.equal(book.record({seq:1,event}).recorded,true);
    ledger.close();ledger=new JobLedger(file);book=bindWorkerUsage({ledger,jobId:'job',generation:1,turnId:'turn'});
    assert.equal(book.record({seq:1,event}).recovered,true);
    assert.deepEqual(book.summary(),{turns:1,knownCostUsd:0,unpricedTurns:1,totalCostUsd:null,knownInputTokens:12,knownOutputTokens:3,unmeasuredTurns:0});
    const changed={...event,cost:0.02};ledger.append(lease,2,changed);
    assert.throws(()=>book.record({seq:2,event:changed}),/Conflicting/);assert.equal(book.summary().turns,1);
  } finally {
    ledger?.close();assert.equal(dirname(resolve(home)),resolve(tmpdir()));assert.ok(basename(home).startsWith('omb-worker-usage-'));rmSync(home,{recursive:true,force:true});
  }
});
test('usage without persisted evidence or with foreign identity cannot book',()=>{
  const ledger=new JobLedger(':memory:');try {
    ledger.enqueue({id:'job',bot:'bot',thread:'thread',project:'project',resource:'desktop'});ledger.claim('job','worker',30000);
    const book=bindWorkerUsage({ledger,jobId:'job',generation:1,turnId:'turn'});
    const event={type:'turn.completed',threadId:'thread',turnId:'turn',usage:{input:1,output:1},cost:0.01};
    assert.throws(()=>book.record({seq:1,event}),/durable/);
    assert.throws(()=>book.record({seq:1,event:{...event,threadId:'foreign'}}),/foreign/);
    assert.equal(book.summary().turns,0);
  } finally {ledger.close();}
});
