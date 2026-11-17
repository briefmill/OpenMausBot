import {randomUUID} from 'node:crypto';

// Controller-owned bridge for mountChatTools. An outer durable tool executor
// must authorize and journal tools/call. Closing a mount never releases a lease.
export function createWorkerBrowserTransport({job,lease,client,isCurrent}) {
  if(!job || !lease || !Number.isSafeInteger(lease.generation) || lease.generation<1 || !Number.isFinite(lease.deadline) || typeof lease.token!=='string' || !lease.token || job.id!==lease.id || job.worker!==lease.worker || job.generation!==lease.generation ||
     typeof client?.browser!=='function' || typeof isCurrent!=='function')throw Error('Current worker browser binding required');
  const binding=structuredClone(lease);
  let closed=false,poisoned=false,catalog,busy=false;
  const current=signal=>{
    signal.throwIfAborted();
    if(closed || poisoned || isCurrent()!==true || binding.deadline<=Date.now())throw Error('Worker browser mount unavailable');
  };
  const rpc=async(method,params,signal)=>{
    current(signal);
    try{
      const result=await client.browser({lease:structuredClone(binding),operation:{id:'browser-'+randomUUID(),method,params},signal});
      current(signal);return result;
    }catch{poisoned=true;throw Error('Worker browser outcome requires reconciliation');}
  };
  const exclusive=async(signal,run)=>{
    current(signal);if(busy)throw Error('Worker browser operation already active');busy=true;
    try{return await run();}finally{busy=false;}
  };
  return{
    async tools(signal,include=()=>true,startupMs=10000) {
      return exclusive(signal,async()=>{
        if(!catalog){
          const bounded=AbortSignal.any([signal,AbortSignal.timeout(startupMs)]);
          await rpc('initialize',{},bounded);
          const listed=await rpc('tools/list',{},bounded);
          if(!Array.isArray(listed?.tools) || listed.tools.length>2000 || Buffer.byteLength(JSON.stringify(listed))>1024*1024){poisoned=true;throw Error('Worker browser catalog invalid');}
          catalog=structuredClone(listed.tools);
        }
        return structuredClone(catalog).filter(include);
      });
    },
    async call(method,params,signal,timeout=15000) {
      return exclusive(signal,async()=>{
        if(!catalog || method!=='tools/call' || !params || typeof params.name!=='string' || !catalog.some(tool=>tool.name===params.name))throw Error('Worker browser tool unavailable');
        return rpc(method,params,AbortSignal.any([signal,AbortSignal.timeout(timeout)]));
      });
    },
    async close(){closed=true;catalog=undefined;},
  };
}
