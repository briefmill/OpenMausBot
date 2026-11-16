import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readdir,readFile} from 'node:fs/promises';
import {setTimeout as pause} from 'node:timers/promises';

const same=(a,b)=>a?.id===b?.id && a?.worker===b?.worker && a?.generation===b?.generation;

// One dedicated PID namespace and worker UID are required. The root supervisor
// and its journal must remain inaccessible to the unprivileged worker UID.
export function createLinuxServiceSupervisor({worker,uid=1000,isolatedPidNamespace=false,stopMs=5000}) {
  if(process.platform!=='linux' || process.getuid?.()!==0 || isolatedPidNamespace!==true ||
     typeof worker!=='string' || !worker || !Number.isSafeInteger(uid) || uid<1000 ||
     !Number.isSafeInteger(stopMs) || stopMs<50 || stopMs>10000)
    throw Error('Dedicated root Linux supervisor required');
  let owner,stopping;
  const check=identity=>{
    if(!same(owner,identity))throw Error('Foreign service process owner');
  };
  const processes=async()=>{
    const found=[];
    for(const name of await readdir('/proc')) {
      if(!/^[1-9][0-9]*$/.test(name))continue;
      let status;
      try{status=await readFile(`/proc/${name}/status`,'utf8');}catch(error){if(error.code==='ENOENT' || error.code==='ESRCH')continue;throw error;}
      const match=/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/m.exec(status);
      if(!match)throw Error('Process ownership inspection failed');
      if(match.slice(1).some(value=>Number(value)===uid))found.push(Number(name));
    }
    return found;
  };
  const run=promisify(execFile);
  const drop=[`--reuid=${uid}`,`--regid=${uid}`,'--clear-groups','--bounding-set=-all',
    '--inh-caps=-all','--ambient-caps=-all','--no-new-privs','--'];
  const signal=async name=>{
    for(const pid of await processes()) {
      try{await run('/usr/bin/setpriv',[...drop,'/bin/kill','-s',name,'--',String(pid)],{timeout:1000,maxBuffer:4096});}
      catch(error){
        if(error.code!==1 || !/No such process/.test(String(error.stderr)))throw Error('Service process signal failed');
      }
    }
  };
  return{
    command:{executable:'/usr/bin/setpriv',args:[`--reuid=${uid}`,`--regid=${uid}`,'--clear-groups',
      '--bounding-set=-all','--inh-caps=-all','--ambient-caps=-all','--no-new-privs','--',process.execPath]},
    async prepare(identity) {
      if(owner || identity?.worker!==worker || typeof identity.id!=='string' || !identity.id ||
         !Number.isSafeInteger(identity.generation) || identity.generation<1)throw Error('Service process owner unavailable');
      owner=structuredClone(identity);
      if((await processes()).length)throw Error('Existing worker processes require reconciliation');
    },
    async stop(identity) {
      check(identity);
      if(stopping)return stopping;
      stopping=(async()=>{
        const deadline=Date.now()+stopMs;
        await signal('SIGTERM');
        while((await processes()).length) {
          check(identity);
          if(Date.now()>=deadline)throw Error('Service process shutdown deadline');
          await signal('SIGKILL');await pause(20);
        }
      })();
      try{await stopping;}finally{stopping=undefined;}
    },
    async inspectStopped(identity) {
      check(identity);
      if(stopping)return false;
      const empty=(await processes()).length===0;
      check(identity);return !stopping && empty;
    },
    async release(identity) {
      check(identity);
      if(stopping || (await processes()).length)throw Error('Service processes still present');
      check(identity);
      if(stopping)throw Error('Service stop still pending');
      owner=undefined;
    },
  };
}
