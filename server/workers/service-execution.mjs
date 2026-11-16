import {DatabaseSync} from 'node:sqlite';

const valid=value=>typeof value==='string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value);
const key=identity=>{
  if(!identity || Object.keys(identity).sort().join(',')!=='generation,id,worker' ||
     !valid(identity.id) || !valid(identity.worker) || !Number.isSafeInteger(identity.generation) || identity.generation<1)
    throw Error('Worker execution identity required');
  return JSON.stringify([identity.id,identity.worker,identity.generation]);
};

// This journal belongs to the trusted service supervisor, outside the worker
// workspace. Only independently verified process shutdown releases its slot.
export function createServiceExecution({file,worker,execute,stop,inspectStopped,stopMs=10000}) {
  if(!Number.isSafeInteger(stopMs) || stopMs<1 || stopMs>30000 || typeof file!=='string' || !file || !valid(worker) ||
     ![execute,stop,inspectStopped].every(value=>typeof value==='function'))throw Error('Trusted service execution required');
  const db=new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS executions (identity TEXT PRIMARY KEY, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS owner (slot INTEGER PRIMARY KEY CHECK(slot=1), identity TEXT NOT NULL);
    UPDATE executions SET state='uncertain' WHERE state='running';`);
  let active=false;
  const identityFor=identity=>{const encoded=key(identity);if(identity.worker!==worker)throw Error('Foreign service worker');return encoded;};
  const state=identity=>db.prepare('SELECT state FROM executions WHERE identity=?').get(identityFor(identity))?.state??null;
  const release=(encoded,outcome)=>{
    db.exec('BEGIN IMMEDIATE');
    try {
      if(db.prepare('SELECT identity FROM owner WHERE slot=1').get()?.identity!==encoded)throw Error('Service owner mismatch');
      db.prepare('UPDATE executions SET state=? WHERE identity=?').run(outcome,encoded);
      db.prepare('DELETE FROM owner WHERE slot=1 AND identity=?').run(encoded);
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  };
  return{
    state,
    hasUncertain(){return db.prepare("SELECT count(*) AS n FROM executions WHERE state='uncertain'").get().n>0;},
    cancelUnseen(identity) {
      const encoded=identityFor(identity);
      return db.prepare("INSERT OR IGNORE INTO executions VALUES (?,'cancelled')").run(encoded).changes===1;
    },
    async run({identity,task,signal}) {
      const encoded=identityFor(identity);
      if(!signal || typeof signal.throwIfAborted!=='function')throw Error('Bounded service execution required');
      signal.throwIfAborted();
      db.exec('BEGIN IMMEDIATE');
      try {
        if(db.prepare('SELECT identity FROM owner WHERE slot=1').get())throw Error('Service execution occupied');
        if(state(identity)!==null)throw Error('Service generation already consumed');
        db.prepare("INSERT INTO executions VALUES (?,'running')").run(encoded);
        db.prepare('INSERT INTO owner VALUES (1,?)').run(encoded);
        db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
      active=true;
      let result,failure;
      let abort;
      try{
        result=await Promise.race([
          Promise.resolve().then(()=>{signal.throwIfAborted();return execute({identity:structuredClone(identity),task,signal});}),
          new Promise((_,reject)=>{
            abort=()=>reject(Error('Service execution cancelled'));
            signal.addEventListener('abort',abort,{once:true});
            if(signal.aborted)abort();
          }),
        ]);
        if(typeof (result?.result?.ok??result?.ok)!=='boolean')throw Error('Service execution receipt required');
      }catch(error){failure=error;}
      finally{if(abort)signal.removeEventListener('abort',abort);}
      let timer;
      try {
        await Promise.race([
          (async()=>{
            await stop(structuredClone(identity));
            if(await inspectStopped(structuredClone(identity))!==true)throw Error('Service stop unverified');
          })(),
          new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Service stop deadline')),stopMs);}),
        ]);
        release(encoded,signal.aborted?'cancelled':failure || result?.result?.ok===false || result?.ok===false?'failed':'completed');
      }catch{
        db.prepare("UPDATE executions SET state='uncertain' WHERE identity=?").run(encoded);
        throw Error('Service stop unverified; reconciliation required');
      }finally{clearTimeout(timer);active=false;}
      if(failure)throw failure;
      return result;
    },
    async reconcile(identity) {
      const encoded=identityFor(identity);
      if(active || state(identity)!=='uncertain')throw Error('Uncertain stopped service required');
      if(await inspectStopped(structuredClone(identity))!==true)throw Error('Service stop unverified');
      release(encoded,'failed');
    },
    close(){if(active)throw Error('Service execution active');db.close();},
  };
}
