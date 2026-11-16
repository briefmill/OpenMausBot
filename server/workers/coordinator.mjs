import { JobLedger } from './ledger.mjs';
import { createJobPlanner } from './job-planner.mjs';
import { createDispatcher } from './dispatch.mjs';
import { createWorkerAdapter } from './controller-adapter.mjs';
import { bindWorkerPermissions } from './controller-permissions.mjs';
import {createDurableToolExecutor} from './tool-executor.mjs';
import { isDeepStrictEqual } from 'node:util';

export function createWorkerCoordinator({ file, assignments, resolveTurn, pools, host, signal, openTools }) {
  if (!signal || !['admit','launch','execute','stop','inspectStopped','health'].every(key => typeof host?.[key] === 'function')) {
    throw Error('Bounded trusted worker host required');
  }
  if (openTools !== undefined && typeof openTools !== 'function') throw Error('Trusted controller tool session factory required');
  const ledger = new JobLedger(file), contexts = new Map(), adapters = new Map();
  const planner = createJobPlanner({ ledger, assignments, resolveTurn });
  const sessionFor = job => {
    const context=contexts.get(job.id);
    if (!context?.tools || context.generation !== job.generation || ledger.get(job.id).state !== 'running')
      throw Error('Controller tool session unavailable');
    return context.tools;
  };
  const tools = openTools ? createDurableToolExecutor({ledger,
    authorize:args=>sessionFor(args.job).authorize(args),dispatch:args=>sessionFor(args.job).dispatch(args)}) : undefined;
  const dispatcher = createDispatcher({ ledger, waitForCapacity:true, signal,
    onQueued:job => {
      const context=contexts.get(job.id);
      context.emit({provider:'isolatedWorker',threadId:job.thread,turnId:context.turnId,eventId:'queued-'+job.id,
        type:'runtime.notice',message:'Waiting for the assigned desktop to become available.'});
    },
    launch: async ({ job, generation }) => {
      const context = contexts.get(job.id);
      if (signal.aborted) throw Error('Worker host stopped');
      await host.admit({ job, pool:context.pool, signal });
      if (context.input.engineAdmission) await context.input.engineAdmission('process');
      if (signal.aborted || ledger.get(job.id).state !== 'running') throw Error('Turn stopped before host launch');
      context.generation = generation;
      context.handle = await host.launch({ job, generation, pool:context.pool, signal });
      if (ledger.get(job.id).state !== 'running') throw Error('Turn stopped during host launch');
      return context.handle;
    },
    execute: async ({ job, lease, handle, heartbeat }) => {
      const context = contexts.get(job.id);
      context.permissions = bindWorkerPermissions({ ledger, jobId:job.id, generation:lease.generation,
        botId:job.bot, threadId:job.thread, turnId:context.turnId, signal,
        isCurrent:() => contexts.get(job.id) === context && ledger.get(job.id).state === 'running' });
      if (openTools) {
        context.tools=await openTools({job,lease,input:context.input,turnId:context.turnId,signal,
          isCurrent:()=>contexts.get(job.id)===context && ledger.get(job.id).state==='running',
          emit:event=>{
            if(event.threadId!==job.thread || event.turnId!==context.turnId || contexts.get(job.id)!==context)
              throw Error('Foreign controller tool event');
            if(!['request.opened','request.resolved','item.started','item.completed','runtime.notice'].includes(event.type))
              throw Error('Invalid controller tool event');
            if(event.type==='request.opened' && ledger.pendingRequests(job.id).some(row=>row.requestId===event.requestId))
              throw Error('Conflicting tool permission identity');
            context.emit({...event,provider:'isolatedWorker'});
          }});
        if(!['authorize','dispatch','hasRequest','respondToRequest','close'].every(key=>typeof context.tools?.[key]==='function'))
          throw Error('Invalid controller tool session');
      }
      try { return await host.execute({ job, lease, handle, input:context.input, turnId:context.turnId, signal, heartbeat,
        emit:event => {
          if (event.threadId !== job.thread || event.turnId !== context.turnId || contexts.get(job.id) !== context) return;
          if (event.type === 'turn.completed' || event.type === 'cap.exhausted') {
            if (context.terminal) throw Error('Conflicting worker terminal');
            context.terminal = structuredClone(event); return;
          }
          if (context.terminal) throw Error('Worker event after terminal');
          if (event.type === 'request.opened') {
            if(context.tools?.hasRequest(event.requestId)) throw Error('Conflicting tool permission identity');
            const { raw, ...request } = event;
            const existing = ledger.pendingRequests(job.id).find(row => row.requestId === request.requestId);
            if (existing) {
              if (existing.generation !== lease.generation || !isDeepStrictEqual({...existing.request,turnId:context.turnId},request))
                throw Error('Remote permission identity mismatch');
            } else ledger.openRequest(lease,request);
          }
          context.emit(event);
        },
        pollPermission:requestId => ledger.pollRequest(lease,requestId),
        acknowledgePermission:(requestId,outcome) => ledger.acknowledgeRequest(lease,requestId,outcome),
      }); } finally { await context.tools?.close(); }
    },
    stop:identity => host.stop(identity), inspectStopped:identity => host.inspectStopped(identity),
  });
  const bootstrap = { pools,
    health:options => !signal.aborted && host.health(options),
    async createAdapter({ instanceId, pool }) {
      if (adapters.has(instanceId)) throw Error('Worker instance requires explicit disposal before replacement');
      const adapter = createWorkerAdapter({ provider:'isolatedWorker', capabilities:{ engineAdmission:true },
        submit:async (input,emit) => {
          if (signal.aborted || (input.engineAdmission !== undefined && typeof input.engineAdmission !== 'function')) throw Error('Worker admission unavailable');
          const plan = planner.plan(input);
          if (plan.pool !== pool || plan.job.state !== 'queued') throw Error('Worker assignment unavailable or awaiting reconciliation');
          const context = { input, emit, pool, worker:plan.worker, jobId:plan.job.id, turnId:'worker-'+plan.job.id };
          contexts.set(plan.job.id,context);
          const completion = new Promise(resolve => setImmediate(resolve)).then(() => dispatcher.dispatch(plan.job.id,plan.worker));
          context.completion = completion;
          completion.then(result => {
            if (result.reason === 'controller-tool-outcome-unverified' && contexts.get(plan.job.id) === context) {
              context.emit({provider:'isolatedWorker',threadId:input.threadId,turnId:context.turnId,
                eventId:'held-tool-'+plan.job.id,type:'runtime.notice',
                message:'A tool may have completed. This job is on hold to prevent duplicate actions. Check its result before retrying.'});
            }
            if (result.settled && contexts.get(plan.job.id) === context) {
              const terminal = context.terminal;
              context.emit(terminal ? {...terminal,ok:result.outcome === 'completed' && terminal.ok === true} : {
                provider:'isolatedWorker',threadId:input.threadId,turnId:context.turnId,eventId:'settled-'+plan.job.id,
                type:'turn.completed',ok:false,stopReason:result.outcome === 'cancelled' ? 'cancelled' : 'worker-execution-failed',
              });
              contexts.delete(plan.job.id);
            }
          }).catch(() => {});
          return { turnId:context.turnId, completion };
        },
        answer:({threadId,turnId,requestId,decision}) => {
          const context = [...contexts.values()].find(value => value.input.threadId === threadId && value.turnId === turnId);
          if(context?.tools?.hasRequest(requestId)) return context.tools.respondToRequest(threadId,requestId,decision);
          return context?.permissions?.respondToRequest(threadId,requestId,decision) ?? 'unavailable';
        },
        cancel:async ({threadId,turnId}) => {
          const context = [...contexts.values()].find(value => value.input.threadId === threadId && (!turnId || value.turnId === turnId));
          if (!context) return false;
          ledger.cancel(context.jobId);
          void Promise.resolve().then(() => host.stop({ id:context.jobId,worker:context.worker,
            generation:context.generation,handle:context.handle })).catch(() => {});
          return false;
        },
      });
      adapters.set(instanceId,adapter); return adapter;
    },
  };
  return { bootstrap, ledger, tools,
    async drain() { return Promise.allSettled([...contexts.values()].map(context => context.completion)); },
    close() {
      if (contexts.size) throw Error('Worker settlement still pending');
      ledger.close();
    },
  };
}
