import { JobLedger } from './ledger.mjs';
import { createJobPlanner } from './job-planner.mjs';
import { createDispatcher } from './dispatch.mjs';
import { createWorkerAdapter } from './controller-adapter.mjs';
import { bindWorkerPermissions } from './controller-permissions.mjs';

export function createWorkerCoordinator({ file, assignments, resolveTurn, pools, host, signal }) {
  if (!signal || !['admit','launch','execute','stop','inspectStopped','health'].every(key => typeof host?.[key] === 'function')) {
    throw Error('Bounded trusted worker host required');
  }
  const ledger = new JobLedger(file), contexts = new Map(), adapters = new Map();
  const planner = createJobPlanner({ ledger, assignments, resolveTurn });
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
      return host.execute({ job, lease, handle, input:context.input, turnId:context.turnId, signal, heartbeat,
        emit:event => {
          if (event.threadId !== job.thread || event.turnId !== context.turnId || contexts.get(job.id) !== context) return;
          if (event.type === 'request.opened') {
            const { raw, ...request } = event; ledger.openRequest(lease,request);
          }
          context.emit(event);
        },
        pollPermission:requestId => ledger.pollRequest(lease,requestId),
        acknowledgePermission:(requestId,outcome) => ledger.acknowledgeRequest(lease,requestId,outcome),
      });
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
          completion.then(result => { if (result.settled && contexts.get(plan.job.id) === context) contexts.delete(plan.job.id); }).catch(() => {});
          return { turnId:context.turnId, completion };
        },
        answer:({threadId,turnId,requestId,decision}) => {
          const context = [...contexts.values()].find(value => value.input.threadId === threadId && value.turnId === turnId);
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
  return { bootstrap, ledger,
    async drain() { return Promise.allSettled([...contexts.values()].map(context => context.completion)); },
    close() {
      if (contexts.size) throw Error('Worker settlement still pending');
      ledger.close();
    },
  };
}
