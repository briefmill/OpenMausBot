import {DatabaseSync} from 'node:sqlite';
import {lstatSync,realpathSync} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';

// Trusted offline administration only. The process probe must independently
// inspect the dedicated worker namespace; a journal state is not shutdown proof.
export async function withStoppedServiceSnapshot({file,worker,inspectStopped,snapshot}) {
  if(!isAbsolute(file??'') || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(worker??'') ||
    typeof inspectStopped!=='function' || typeof snapshot!=='function')throw Error('Trusted snapshot authority required');
  for(const path of [file,file+'.supervisor-lock']) {
    const info=lstatSync(path);
    if(!info.isFile() || info.isSymbolicLink() || realpathSync(path)!==resolve(path) ||
       (process.platform==='linux' && (info.uid!==0 || (info.mode&0o022)!==0)))throw Error('Protected existing journal required');
  }
  let lock,db;
  try {
    lock=new DatabaseSync(file+'.supervisor-lock');
    lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;');
    db=new DatabaseSync(file,{readOnly:true});
    const check=async()=>{
      if(db.prepare('SELECT count(*) AS n FROM owner').get().n!==0 ||
         db.prepare("SELECT count(*) AS n FROM executions WHERE state NOT IN ('completed','failed','cancelled')").get().n!==0)
        throw Error('Unresolved worker execution requires reconciliation');
      for(const row of db.prepare('SELECT identity FROM executions').all()) {
        const identity=JSON.parse(row.identity);
        if(!Array.isArray(identity) || identity.length!==3 || identity[1]!==worker)throw Error('Foreign journal identity');
      }
      if(await inspectStopped({worker})!==true)throw Error('Worker shutdown unverified');
    };
    await check();
    const result=await snapshot({file,worker});
    await check();
    return result;
  } catch(error) {
    if(error.code==='ERR_SQLITE_ERROR' && /locked/.test(error.message))throw Error('Supervisor authority active');
    throw error;
  } finally {try{db?.close();}finally{lock?.close();}}
}
