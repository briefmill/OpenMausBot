import {randomUUID} from 'node:crypto';
import {createChatToolApproval} from '../drivers/chat-tool-approval.ts';
import {bindControllerToolPolicy} from './controller-tool-policy.mjs';

export function createControllerToolSession({job,turnId,session,signal,isCurrent,emit,mode,preview,granted,timeoutMs}) {
  const requests=new Set();
  const event=value=>emit({eventId:randomUUID(),provider:'isolatedWorker',threadId:job.thread,turnId,...value});
  const approval=createChatToolApproval({signal,granted,timeoutMs,
    open:ask=>{
      requests.add(ask.id);
      event({type:'request.opened',requestType:'permission',requestId:ask.id,tool:ask.tool,
        summary:ask.summary,allowSession:ask.grant!==undefined});
    },
    resolved:(ask,allowed,source)=>{
      requests.delete(ask.id);
      event({type:'request.resolved',requestId:ask.id,behavior:allowed?'allow':'deny',source});
    },
    openQuestion:()=>{throw Error('Tool relay questions require a separate handler');},resolvedQuestion:()=>{},
  });
  const policy=bindControllerToolPolicy({identity:Object.fromEntries(['id','bot','thread','project','generation'].map(key=>[key,job[key]])),
    session,approval,mode,preview,signal,isCurrent});
  let closed=false;
  return {
    definitions() {
      signal.throwIfAborted();if(closed || !isCurrent())throw Error('Tool catalog unavailable');
      const definitions=structuredClone(session.definitions ?? []);
      if(Buffer.byteLength(JSON.stringify(definitions))>1024*1024)throw Error('Tool catalog exceeds delivery budget');
      return definitions;
    },
    authorize:args=>policy.authorize(args),dispatch:args=>policy.dispatch(args),
    hasRequest:id=>!closed && requests.has(id),
    respondToRequest(thread,id,decision) {
      if(closed || thread!==job.thread || !isCurrent() || !requests.has(id))return 'unavailable';
      return approval.answer(id,decision?.behavior,decision?.message,decision?.always);
    },
    async close() {
      if(closed)return;closed=true;approval.close();await session.close();
    },
  };
}
