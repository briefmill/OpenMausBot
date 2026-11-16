import {createHash} from 'node:crypto';
const fingerprint=call=>createHash('sha256').update(JSON.stringify(call)).digest('hex');

// The controller supplies an account-scoped ChatToolSession and its existing
// ChatToolApproval gate. Workers cannot supply policy, grants or session mounts.
export function bindControllerToolPolicy({identity,session,approval,mode,preview,signal,isCurrent}) {
  if (!identity || !['id','bot','thread','project','generation'].every(key=>identity[key]!==undefined) ||
      !['validate','view','execute'].every(key=>typeof session?.[key]==='function') ||
      !['floored','ask'].every(key=>typeof approval?.[key]==='function') ||
      ![mode,preview,isCurrent].every(value=>typeof value==='function') || !signal)
    throw Error('Trusted scoped tool policy required');
  const binding=structuredClone(identity),tickets=new Map();
  const current=(job,operationSignal)=>{
    signal.throwIfAborted();operationSignal.throwIfAborted();
    if(isCurrent()!==true || Object.keys(binding).some(key=>job[key]!==binding[key]))
      throw Error('Tool session assignment unavailable');
  };
  return {
    async authorize({job,call,signal:operationSignal}) {
      current(job,operationSignal);
      session.validate(call.tool,call.arguments);
      const shown=session.view(call.tool,call.arguments),summary=preview(shown.input);
      const access=mode();if(!['ask','full'].includes(access))throw Error('Tool approval mode unavailable');
      const full=access==='full';
      const floor=approval.floored({full,threadId:binding.thread,botId:binding.bot,shown,summary});
      const allowed=!floor && (full || !shown.ask || await approval.ask(shown.title,summary,shown.grant));
      current(job,operationSignal);
      if(allowed)tickets.set(call.id,fingerprint(call));
      return allowed;
    },
    async dispatch({job,call,signal:operationSignal}) {
      current(job,operationSignal);
      if(tickets.get(call.id)!==fingerprint(call))throw Error('Tool dispatch lacks matching authorization');
      tickets.delete(call.id);
      session.validate(call.tool,call.arguments);
      return session.execute(call.tool,call.arguments,AbortSignal.any([signal,operationSignal]));
    },
  };
}
