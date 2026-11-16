import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,dirname,basename } from 'node:path';
test('actual Store delivery survives failure after reply save and before cursor commit',()=>{
  const home=mkdtempSync(join(tmpdir(),'omb-worker-delivery-'));
  const source=`
    import assert from 'node:assert/strict';import path from 'node:path';
    const {Store}=await import(${JSON.stringify(new URL('../store.ts',import.meta.url).href)});
    const {commandReceipt}=await import(${JSON.stringify(new URL('../commands.ts',import.meta.url).href)});
    const {closeMessageDb}=await import(${JSON.stringify(new URL('../message-db.ts',import.meta.url).href)});
    const {JobLedger}=await import(${JSON.stringify(new URL('./ledger.mjs',import.meta.url).href)});
    const {bindWorkerDelivery}=await import(${JSON.stringify(new URL('./delivery-journal.mjs',import.meta.url).href)});
    let store=new Store(()=>({instanceId:'synthetic',model:'synthetic'})),ledger=new JobLedger(path.join(process.env.OMB_DATA_DIR,'worker.db'));
    const bot=store.createBot(),other=store.createBot();
    ledger.enqueue({id:'job',bot:bot.id,thread:bot.threadId,project:'synthetic',resource:'desktop'});
    const lease=ledger.claim('job','worker',30000);
    ledger.append(lease,1,{type:'worker.execution.claimed',jobId:'job',generation:1});
    ledger.append(lease,2,{type:'item.completed',itemType:'assistant_text',threadId:bot.threadId,turnId:'turn',text:'Remote report synthetic-secret'});
    ledger.append(lease,3,{type:'turn.completed',threadId:bot.threadId,turnId:'turn',cost:0.01,usage:{input:10,output:2}});
    const bind=()=>bindWorkerDelivery({ledger,store,commandReceipt,jobId:'job',generation:1,turnId:'turn',redactText:text=>text.replaceAll('synthetic-secret','[redacted]')});
    let delivery=bind();
    ledger.db.exec("CREATE TEMP TRIGGER fail_cursor BEFORE INSERT ON worker_event_cursors WHEN NEW.seq=2 BEGIN SELECT RAISE(ABORT,'synthetic cursor failure'); END");
    assert.throws(()=>delivery.drain(),/synthetic cursor failure/);
    assert.equal(delivery.cursor(),1);assert.equal(delivery.usageSummary().turns,1);
    ledger.close();closeMessageDb();
    store=new Store(()=>({instanceId:'synthetic',model:'synthetic'}));ledger=new JobLedger(path.join(process.env.OMB_DATA_DIR,'worker.db'));delivery=bind();
    const replay=delivery.drain();assert.equal(replay.recoveredReplies,1);assert.equal(replay.lastSeq,3);
    assert.equal(store.messagesFor(bot.threadId).filter(message=>message.text==='Remote report [redacted]').length,1);
    assert.equal(delivery.usageSummary().turns,1);assert.equal(delivery.usageSummary().totalCostUsd,0.01);
    assert.equal(delivery.drain().processed,0);
    ledger.append(lease,4,{type:'item.completed',itemType:'assistant_text',threadId:other.threadId,turnId:'turn',text:'Foreign output'});
    assert.throws(()=>delivery.drain(),/Foreign|foreign/);assert.equal(delivery.cursor(),3);
    assert.equal(store.messagesFor(other.threadId).some(message=>message.text==='Foreign output'),false);
    ledger.close();closeMessageDb();console.log(JSON.stringify({replyCopies:1,usageRecords:1,cursorRecovered:true,foreignThreadDenied:true}));
  `;
  try {
    const output=execFileSync(process.execPath,['--input-type=module','-e',source],{timeout:15000,windowsHide:true,encoding:'utf8',
      env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,HOME:home,USERPROFILE:home,TEMP:home,TMP:home,OMB_DATA_DIR:home,OMB_DISABLE_MODEL_MANIFEST_FETCH:'1'}});
    assert.equal(JSON.parse(output.trim()).cursorRecovered,true);
  } finally {
    assert.equal(dirname(resolve(home)),resolve(tmpdir()));assert.ok(basename(home).startsWith('omb-worker-delivery-'));
    rmSync(home,{recursive:true,force:true});
  }
});
