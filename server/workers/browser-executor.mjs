import {ChatMcpClient} from '../drivers/chat-mcp-tools.ts';
import {lstatSync,realpathSync} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {normalizeWorkerAssignment,workerAssignmentMatches} from './worker-assignment.mjs';
const same=(a,b)=>a?.id===b?.id && a?.generation===b?.generation && a?.worker===b?.worker;

// Operator-owned runtime only. Call through the controller's durable approval
// journal; this backend does not grant permission or certify process shutdown.
export function createWorkerBrowserExecutor({worker,assignment,uid=1000,cwd,binaryPath,chromePath,stopProcesses}) {
  if((stopProcesses!==undefined && typeof stopProcesses!=='function') || process.platform!=='linux' || process.getuid?.()!==0 || !Number.isSafeInteger(uid) || uid<1000 ||
     ![cwd,binaryPath,chromePath].every(path=>typeof path==='string' && isAbsolute(path)) ||
     !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(worker??''))throw Error('Trusted Linux browser runtime required');
  const policy=normalizeWorkerAssignment(assignment);
  for(const file of [binaryPath,chromePath]){
    const info=lstatSync(file);
    if(!info.isFile() || info.uid!==0 || (info.mode&0o022)!==0 || (info.mode&0o111)===0 || realpathSync(file)!==resolve(file))throw Error('Protected browser executable required');
  }
  const workspace=lstatSync(cwd);
  if(!workspace.isDirectory() || workspace.isSymbolicLink() || workspace.uid!==uid || realpathSync(cwd)!==resolve(cwd))throw Error('Assigned browser workspace required');
  const session='worker-'+createHash('sha256').update(worker).digest('hex').slice(0,24);
  let active,client,catalog,poisoned=false,busy=false;
  return{
    uncertain:()=>poisoned,
    async operate({job,lease,operation,signal}){
      signal.throwIfAborted();
      if(poisoned || busy || job.worker!==worker || lease.worker!==worker || job.id!==lease.id || !workerAssignmentMatches(policy,job) ||
         !Number.isSafeInteger(lease.generation) || lease.generation<1 || lease.deadline<=Date.now() ||
         !['initialize','tools/list','tools/call'].includes(operation?.method))throw Error('Browser operation unavailable');
      if(active && !same(active,lease))throw Error('Foreign browser owner');
      if(operation.method!=='initialize' && !catalog)throw Error('Browser initialization required');
      if(operation.method==='tools/call'){
        const args=operation.params?.arguments;
        if(!catalog.some(tool=>tool.name===operation.params?.name) || !args || typeof args!=='object' || Array.isArray(args) ||
          (args.session!==undefined && args.session!==session) || ['profile','cdp','executablePath'].some(key=>Object.hasOwn(args,key)))throw Error('Foreign browser tool target');
      }
      busy=true;
      try{
        if(!client){
          active=structuredClone(lease);
          client=new ChatMcpClient({command:'/usr/bin/setpriv',args:[`--reuid=${uid}`,`--regid=${uid}`,'--clear-groups','--bounding-set=-all','--inh-caps=-all','--ambient-caps=-all','--no-new-privs','--',binaryPath,'mcp','--tools','core','--no-webmcp'],
            env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:cwd,AGENT_BROWSER_EXECUTABLE_PATH:chromePath,AGENT_BROWSER_SESSION:session,
              AGENT_BROWSER_PROFILE:join(cwd,'browser-profile'),AGENT_BROWSER_HEADLESS:'1',AGENT_BROWSER_HEADED:'0'}},true,false,{},stopProcesses ? async()=>{await stopProcesses(structuredClone(active));return true;} : undefined);
        }
        if(operation.method==='initialize'){
          if(catalog)throw Error('Browser already initialized');
          catalog=await client.tools(signal,()=>true,10000);
          return{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'worker-browser',version:'1'}};
        }
        if(operation.method==='tools/list')return{tools:structuredClone(catalog)};
        return await client.call('tools/call',operation.params,signal,15000);
      }catch(error){poisoned=true;throw error;}finally{busy=false;}
    },
    async close(identity){
      if(active && !same(active,identity))throw Error('Foreign browser shutdown');
      if(client){
        try{if(!poisoned && catalog?.some(tool=>tool.name==='agent_browser_close'))await client.call('tools/call',{name:'agent_browser_close',arguments:{}},AbortSignal.timeout(5000),5000);}
        finally{await client.close();client=null;catalog=null;active=null;}
      }
    },
  };
}
