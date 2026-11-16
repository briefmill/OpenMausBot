import { setTimeout as pause } from 'node:timers/promises';

export function createRemoteExecution({ ledger, executeWorker, pollMs = 20 }) {
  if (!ledger || typeof executeWorker !== 'function' || !Number.isSafeInteger(pollMs) || pollMs < 1 || pollMs > 1000)
    throw Error('Trusted remote execution binding required');
  return async function execute({job,lease,handle,input,turnId,signal,emit}) {
    if (!signal || typeof emit !== 'function') throw Error('Bounded remote execution required');
    let finished=false, result, failure, cursor=0, providerTurn, terminal;
    const opened=new Set();
    const running=Promise.resolve().then(()=>executeWorker({job,lease,handle,input,signal})).then(
      value=>{result=value;finished=true;},error=>{failure=error;finished=true;});
    while (true) {
      signal.throwIfAborted();
      const current=ledger.get(job.id);
      if(current.generation!==lease.generation || current.worker!==lease.worker)throw Error('Stale remote execution');
      const page=ledger.readEvents(job.id,cursor);
      for(const row of page.events) {
        const event=row.event;
        if(event.type==='worker.execution.claimed'){cursor=row.seq;continue;}
        if(event.threadId!==job.thread || typeof event.turnId!=='string')throw Error('Foreign remote event');
        if(providerTurn && providerTurn!==event.turnId)throw Error('Conflicting provider turn');
        providerTurn=event.turnId;
        if(terminal)throw Error('Remote event after terminal');
        if(event.type==='request.opened') {
          const pending=ledger.pendingRequests(job.id).find(value=>value.requestId===event.requestId);
          if(!pending){if(!finished)break;throw Error('Missing durable permission evidence');}
          if(pending.generation!==lease.generation || pending.request.threadId!==job.thread || pending.request.turnId!==providerTurn)
            throw Error('Foreign remote permission');
          if(!opened.has(event.requestId)) {
            const {raw,...request}=pending.request;
            emit({...request,turnId});opened.add(event.requestId);
          }
        } else {
          if(event.type==='turn.completed' || event.type==='cap.exhausted')terminal=event;
          else emit({...event,turnId});
        }
        cursor=row.seq;
      }
      if(finished && !page.hasMore && cursor===page.lastSeq)break;
      await pause(pollMs,undefined,{signal});
    }
    await running;
    if(failure)throw failure;
    if(!result?.result || result.lease?.generation!==lease.generation || result.lease?.id!==job.id ||
       result.lease?.worker!==lease.worker || result.lease?.token!==lease.token ||
       result.result.turnId!==providerTurn || !terminal ||
       result.result.ok !== (terminal.type==='turn.completed' && terminal.ok===true))
      throw Error('Remote terminal receipt mismatch');
    emit({...terminal,turnId});
    return result;
  };
}
