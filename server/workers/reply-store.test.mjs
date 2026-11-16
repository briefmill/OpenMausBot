import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,dirname,basename } from 'node:path';
test('actual Store reply receipt survives reopen without duplicate or foreign publication',()=>{
  const home=mkdtempSync(join(tmpdir(),'omb-worker-reply-'));
  const source=`
    import assert from 'node:assert/strict';
    const {Store}=await import(${JSON.stringify(new URL('../store.ts',import.meta.url).href)});
    const {commandReceipt}=await import(${JSON.stringify(new URL('../commands.ts',import.meta.url).href)});
    const {closeMessageDb}=await import(${JSON.stringify(new URL('../message-db.ts',import.meta.url).href)});
    const {bindWorkerReplies}=await import(${JSON.stringify(new URL('./reply-store.mjs',import.meta.url).href)});
    let store=new Store(()=>({instanceId:'synthetic',model:'synthetic'}));
    const bot=store.createBot(),other=store.createBot();
    const job={id:'job',bot:bot.id,thread:bot.threadId,generation:1,state:'completed'};
    const bind=()=>bindWorkerReplies({store,commandReceipt,getJob:()=>job,jobId:'job',generation:1,redactText:text=>text.replaceAll('synthetic-secret','[redacted]')});
    const row={seq:2,event:{type:'item.completed',itemType:'assistant_text',threadId:bot.threadId,turnId:'turn',text:'Report synthetic-secret'}};
    const first=bind()(row);assert.equal(first.recovered,false);
    closeMessageDb();store=new Store(()=>({instanceId:'synthetic',model:'synthetic'}));
    const recovered=bind()(row);assert.equal(recovered.recovered,true);assert.equal(recovered.reportId,first.reportId);
    assert.equal(store.messagesFor(bot.threadId).filter(message=>message.id===first.reportId).length,1);
    assert.equal(store.messagesFor(bot.threadId).find(message=>message.id===first.reportId).text,'Report [redacted]');
    assert.throws(()=>bind()({...row,event:{...row.event,text:'Changed report'}}),/Conflicting/);
    assert.throws(()=>bind()({...row,event:{...row.event,threadId:other.threadId}}),/foreign/);
    job.generation=2;assert.throws(()=>bind()(row),/Stale/);closeMessageDb();
    console.log(JSON.stringify({actualStore:true,reopenReplay:true,replyCopies:1,foreignThreadDenied:true,changedReplayDenied:true,redactionApplied:true}));
  `;
  try {
    const output=execFileSync(process.execPath,['--input-type=module','-e',source],{timeout:15000,windowsHide:true,encoding:'utf8',
      env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,HOME:home,USERPROFILE:home,TEMP:home,TMP:home,OMB_DATA_DIR:home,OMB_DISABLE_MODEL_MANIFEST_FETCH:'1'}});
    assert.equal(JSON.parse(output.trim()).replyCopies,1);
  } finally {
    assert.equal(dirname(resolve(home)),resolve(tmpdir()));assert.ok(basename(home).startsWith('omb-worker-reply-'));
    rmSync(home,{recursive:true,force:true});
  }
});
