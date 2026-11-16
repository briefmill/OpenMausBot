import { isAbsolute } from 'node:path';

const strings = new Set(['text','recalled','system','systemStable','systemVolatile','recoveryText']);
const flags = new Set(['mentionTurn','preloadBrowserTools']);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');

// Trusted process bootstrap owns the adapter, lease identity, paths and tool
// descriptors. Job content cannot replace them or carry executable settings.
export function createBoundWorkerRuntime({client,adapter,binding,input}) {
  if (!client || typeof client.run !== 'function' || !adapter ||
      !exact(binding,['jobId','worker','generation','botId','threadId']) ||
      !['jobId','worker','botId','threadId'].every(key=>typeof binding[key]==='string' && binding[key].length>0) ||
      !Number.isSafeInteger(binding.generation) || binding.generation<1 ||
      input?.botId!==binding.botId || input.threadId!==binding.threadId ||
      input.approvalMode!=='ask' || input.mcpFromUserConfig!==false ||
      !input.toolScope || !isAbsolute(input.cwd ?? '') ||
      typeof input.engineAdmission!=='function' || typeof input.approvalModeNow!=='function')
    throw Error('Trusted scoped worker bootstrap required');
  const approved=structuredClone(binding);
  const callbacks={engineAdmission:input.engineAdmission,approvalModeNow:input.approvalModeNow};
  const fixed=structuredClone(Object.fromEntries(Object.entries(input).filter(([key])=>!Object.hasOwn(callbacks,key))));
  let consumed=false;
  return {
    async run(task,signal) {
      if(consumed)throw Error('Worker runtime already consumed; reconciliation required');
      if(!signal || typeof signal.throwIfAborted!=='function')throw Error('Bounded worker signal required');
      signal.throwIfAborted();
      if(!exact(task,['jobId','lease','content']) || task.jobId!==approved.jobId ||
         !exact(task.lease,['id','worker','generation','token','deadline']) || task.lease.id!==approved.jobId ||
         task.lease.worker!==approved.worker || task.lease.generation!==approved.generation ||
         !Number.isSafeInteger(task.lease.deadline) || task.lease.deadline<=Date.now() ||
         typeof task.lease.token!=='string' || !/^[a-f0-9]{64}$/.test(task.lease.token))
        throw Error('Foreign worker task');
      const content=structuredClone(task.content);
      if(!content || typeof content!=='object' || Array.isArray(content) || typeof content.text!=='string')
        throw Error('Worker conversation content required');
      for(const [key,value] of Object.entries(content)) {
        if(strings.has(key)){if(typeof value!=='string')throw Error('Invalid worker text');}
        else if(flags.has(key)){if(typeof value!=='boolean')throw Error('Invalid worker flag');}
        else if(key==='transcript') {
          if(!Array.isArray(value) || value.some(row=>!exact(row,['role','text']) ||
              !['user','assistant'].includes(row.role) || typeof row.text!=='string'))throw Error('Invalid worker transcript');
        } else throw Error('Worker content cannot select execution settings');
      }
      if(Buffer.byteLength(JSON.stringify(content))>4*1024*1024)throw Error('Worker conversation too large');
      if(callbacks.approvalModeNow()!=='ask')throw Error('Worker approval scope changed');
      consumed=true;
      return client.run({jobId:approved.jobId,lease:structuredClone(task.lease),adapter,signal,
        input:{...structuredClone(fixed),...content,...callbacks}});
    },
  };
}
