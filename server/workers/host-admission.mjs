import {setTimeout as pause} from 'node:timers/promises';

export function createHostAdmission({limit,isCurrent,signal}) {
  if(!Number.isSafeInteger(limit) || limit<1 || limit>64 || typeof isCurrent!=='function' || !signal)
    throw Error('Bounded host admission policy required');
  const held=new Map();
  const current=job=>{signal.throwIfAborted();if(isCurrent(job)!==true)throw Error('Worker admission cancelled');};
  return{
    async acquire({job}) {
      if(typeof job?.id!=='string' || typeof job.worker!=='string' || !Number.isSafeInteger(job.generation) || job.generation<1)
        throw Error('Worker admission identity required');
      if(held.has(job.id))throw Error('Worker admission already reserved');
      while(held.size>=limit){current(job);await pause(25,undefined,{signal});}
      current(job);held.set(job.id,{worker:job.worker,generation:job.generation});
    },
    release(identity) {
      const owner=held.get(identity.id);
      if(!owner || owner.worker!==identity.worker || owner.generation!==identity.generation)return false;
      return held.delete(identity.id);
    },
  };
}
