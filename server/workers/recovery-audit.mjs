import {DatabaseSync} from 'node:sqlite';
import {lstatSync,realpathSync} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';

// Trusted offline audit. Its report is not permission to release leases or
// activate a worker; keep admission stopped while comparing controller authority.
export function auditRestoredWorkerAgainstController({controllerFile,worker,receipts}) {
  if(!isAbsolute(controllerFile??'') || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(worker??'') || !Array.isArray(receipts))throw Error('Trusted recovery comparison required');
  const info=lstatSync(controllerFile);
  if(!info.isFile() || info.isSymbolicLink() || realpathSync(controllerFile)!==resolve(controllerFile))throw Error('Existing controller journal required');
  const restored=new Map();
  for(const row of receipts){
    const key=JSON.parse(row.identity);
    if(!Array.isArray(key) || key.length!==3 || typeof key[0]!=='string' || key[1]!==worker ||
      !Number.isSafeInteger(key[2]) || key[2]<1 || !['completed','failed','cancelled'].includes(row.state) || restored.has(key[0]))throw Error('Invalid restored receipts');
    restored.set(key[0],{generation:key[2],state:row.state});
  }
  const db=new DatabaseSync(controllerFile,{readOnly:true}),issues=[];
  try{
    db.exec('BEGIN;');
    const jobs=db.prepare('SELECT id,worker,generation,state FROM jobs WHERE worker=? ORDER BY id').all(worker);
    const seen=new Set();
    for(const job of jobs){
      seen.add(job.id);const receipt=restored.get(job.id);
      if(!['completed','failed','cancelled'].includes(job.state))issues.push({job:job.id,reason:'controller-execution-unresolved'});
      else if(!receipt)issues.push({job:job.id,reason:'controller-job-missing-from-snapshot'});
      else if(receipt.generation!==job.generation || receipt.state!==job.state)issues.push({job:job.id,reason:'controller-receipt-mismatch'});
    }
    for(const id of restored.keys())if(!seen.has(id))issues.push({job:id,reason:'snapshot-job-missing-from-controller'});
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='worker_tool_calls'").get()){
      for(const row of db.prepare("SELECT DISTINCT t.job FROM worker_tool_calls t JOIN jobs j ON j.id=t.job WHERE j.worker=? AND t.state IN ('pending','dispatching','uncertain')").all(worker))issues.push({job:row.job,reason:'controller-tool-outcome-unresolved'});
    }
    return{worker,receiptsCompared:restored.size,controllerJobsCompared:jobs.length,consistent:issues.length===0,issues,activationAuthorized:false};
  }finally{db.close();}
}
