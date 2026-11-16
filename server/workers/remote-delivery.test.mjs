import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,dirname,basename } from 'node:path';
test('worker HTTP events publish one actual Store reply and usage record after cursor rewind',()=>{
  const home=mkdtempSync(join(tmpdir(),'omb-remote-delivery-'));
  const source=`
    import assert from 'node:assert/strict';import path from 'node:path';import {randomBytes} from 'node:crypto';
    const {Store}=await import(${JSON.stringify(new URL('../store.ts',import.meta.url).href)});
    const {commandReceipt}=await import(${JSON.stringify(new URL('../commands.ts',import.meta.url).href)});
    const {closeMessageDb}=await import(${JSON.stringify(new URL('../message-db.ts',import.meta.url).href)});
    const {JobLedger}=await import(${JSON.stringify(new URL('./ledger.mjs',import.meta.url).href)});
    const {listenTransport}=await import(${JSON.stringify(new URL('./transport.mjs',import.meta.url).href)});
    const {workerClient}=await import(${JSON.stringify(new URL('./worker-client.mjs',import.meta.url).href)});
    const {bindWorkerDelivery}=await import(${JSON.stringify(new URL('./delivery-journal.mjs',import.meta.url).href)});
    let store=new Store(()=>({instanceId:'synthetic',model:'synthetic'}));const bot=store.createBot();
    const ledger=new JobLedger(path.join(process.env.OMB_DATA_DIR,'workers.db'));
    const assignment={bot:bot.id,thread:bot.threadId,project:'synthetic',resource:'desktop'};
    const token=randomBytes(32).toString('hex');
    const transport=await listenTransport({ledger,controllerToken:randomBytes(32).toString('hex'),workers:[{id:'worker',token,capacity:1,assignments:[assignment]}]});
    const client=workerClient({origin:transport.origin,token});let listener,starts=0,notifications=0;
    const observe=()=>store.onChange(change=>{if(change.type==='message'&&change.message?.text==='Remote HTTP report')notifications++;});observe();
    const emit=event=>listener?.({eventId:event.type,provider:'synthetic',threadId:bot.threadId,turnId:'turn',...event});
    const adapter={capabilities:{engineAdmission:true},onEvent(fn){listener=fn;return()=>{listener=null}},
      async sendTurn(input){starts++;await input.engineAdmission('process');setImmediate(()=>{
        emit({type:'content.delta',streamKind:'assistant_text',delta:'Remote HTTP report'});
        emit({type:'item.completed',itemType:'assistant_text',text:'Remote HTTP report'});
        emit({type:'turn.completed',ok:true,usage:{input:10,output:3},cost:0.02});
      });return{turnId:'turn'};},async interruptTurn(){}};
    try{
      ledger.enqueue({id:'job',...assignment});const lease=ledger.claim('job','worker',30000);
      const result=await client.run({jobId:'job',lease,adapter,signal:AbortSignal.timeout(3000),input:{botId:bot.id,threadId:bot.threadId,
        text:'Synthetic',approvalMode:'ask',mcpFromUserConfig:false,toolScope:{},engineAdmission:async()=>{},approvalModeNow:()=> 'ask'}});
      assert.equal(result.result.ok,true);assert.equal(starts,1);
      const bind=()=>bindWorkerDelivery({ledger,store,commandReceipt,jobId:'job',generation:1,turnId:'turn',redactText:text=>text});
      let delivery=bind();assert.equal(delivery.drain().processed,4);assert.equal(notifications,1);
      closeMessageDb();store=new Store(()=>({instanceId:'synthetic',model:'synthetic'}));observe();
      ledger.db.prepare('DELETE FROM worker_event_cursors WHERE job=?').run('job');delivery=bind();
      assert.equal(delivery.drain().recoveredReplies,1);assert.equal(notifications,1);
      assert.equal(store.messagesFor(bot.threadId).filter(message=>message.text==='Remote HTTP report').length,1);
      assert.equal(delivery.usageSummary().turns,1);assert.equal(delivery.usageSummary().totalCostUsd,0.02);
      assert.equal(delivery.drain().processed,0);assert.equal(starts,1);
      assert.equal(ledger.get('job').state,'running');
      console.log(JSON.stringify({actualStore:true,authenticatedHTTP:true,publishedReplies:1,usageRecords:1,providerStarts:1,cursorRewindRecovered:true}));
    }finally{client.close();await transport.close();ledger.close();closeMessageDb();}
  `;
  try {
    const output=execFileSync(process.execPath,['--input-type=module','-e',source],{timeout:15000,windowsHide:true,encoding:'utf8',
      env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,HOME:home,USERPROFILE:home,TEMP:home,TMP:home,OMB_DATA_DIR:home,OMB_DISABLE_MODEL_MANIFEST_FETCH:'1'}});
    assert.equal(JSON.parse(output.trim()).cursorRewindRecovered,true);
  } finally {
    assert.equal(dirname(resolve(home)),resolve(tmpdir()));assert.ok(basename(home).startsWith('omb-remote-delivery-'));
    rmSync(home,{recursive:true,force:true});
  }
});
