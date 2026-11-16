import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {JobLedger} from './ledger.mjs';
import {auditRestoredWorkerAgainstController} from './recovery-audit.mjs';

test('recovery audit detects post-snapshot jobs and unresolved controller work without mutation',()=>{
 const root=mkdtempSync(join(tmpdir(),'omb-recovery-audit-')),file=join(root,'controller.db');const ledger=new JobLedger(file);
 const add=id=>{ledger.enqueue({id,bot:'bot',thread:'thread-'+id,project:'project',resource:'desktop-'+id});return ledger.claim(id,'worker',10000);};
 const finish=lease=>ledger.finish(lease,'completed',ledger.putArtifact(lease,Buffer.from('synthetic')));
 try{
  const a=add('a');finish(a);
  const receipts=[{identity:JSON.stringify(['a','worker',1]),state:'completed'}];
  const args={controllerFile:file,worker:'worker',receipts};
  assert.equal(auditRestoredWorkerAgainstController(args).consistent,true);
  const b=add('b');let audit=auditRestoredWorkerAgainstController(args);
  assert.equal(audit.consistent,false);assert.equal(audit.issues[0].reason,'controller-execution-unresolved');assert.equal(ledger.get('b').state,'running');
  finish(b);audit=auditRestoredWorkerAgainstController(args);assert.equal(audit.issues[0].reason,'controller-job-missing-from-snapshot');
  const mismatch=auditRestoredWorkerAgainstController({...args,receipts:[{...receipts[0],state:'failed'}]});assert.ok(mismatch.issues.some(x=>x.reason==='controller-receipt-mismatch'));
  const missing=auditRestoredWorkerAgainstController({...args,receipts:[...receipts,{identity:JSON.stringify(['missing','worker',1]),state:'completed'}]});assert.ok(missing.issues.some(x=>x.reason==='snapshot-job-missing-from-controller'));
  assert.equal(audit.activationAuthorized,false);
  ledger.db.exec('CREATE TABLE worker_tool_calls (job TEXT,state TEXT)');
  ledger.db.prepare('INSERT INTO worker_tool_calls VALUES (?,?)').run('a','uncertain');
  const uncertain=auditRestoredWorkerAgainstController(args);assert.ok(uncertain.issues.some(x=>x.reason==='controller-tool-outcome-unresolved'));
 }finally{ledger.close();rmSync(root,{recursive:true,force:true});}
});
