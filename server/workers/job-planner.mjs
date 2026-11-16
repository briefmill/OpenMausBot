import { createHash } from 'node:crypto';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id = value => { if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value)) throw Error('Invalid assignment identity'); return value; };
// Trusted controller bootstrap supplies assignments and resolves the current
// request from its Store. Prompt text never selects a worker or host resource.
export function createJobPlanner({ ledger, assignments, resolveTurn }) {
  if (typeof resolveTurn !== 'function' || !Array.isArray(assignments)) throw Error('Trusted turn resolver required');
  const approved = structuredClone(assignments).map(a => Object.fromEntries(
    ['bot','project','pool','worker','desktop','workspace'].map(key => [key,id(a[key])])));
  if (new Set(approved.map(a => a.bot)).size !== approved.length) throw Error('Ambiguous bot assignment');
  ledger.db.exec('CREATE TABLE IF NOT EXISTS worker_turn_bindings (request_key TEXT PRIMARY KEY, context_sha TEXT NOT NULL, job_id TEXT UNIQUE NOT NULL REFERENCES jobs(id))');
  return {
    plan(input) {
      if (typeof input?.text !== 'string' || input.approvalMode !== 'ask' || input.mcpFromUserConfig !== false)
        throw Error('Scoped Ask-mode worker input required');
      const assignment = approved.find(a => a.bot === input.botId);
      if (!assignment) throw Error('Bot has no approved worker assignment');
      const turn = resolveTurn(input.botId,input.threadId);
      if (!turn || turn.bot !== input.botId || turn.thread !== input.threadId || turn.active !== true) throw Error('Foreign or inactive controller turn');
      id(turn.requestId);id(turn.thread);
      const requestKey = digest([turn.bot,turn.thread,turn.requestId]);
      // Store a digest, never prompt bodies or credentials. Changing a request's
      // execution context requires explicit reconciliation, not a new job ID.
      const execution = Object.fromEntries(Object.entries(input).filter(([,value]) => typeof value !== 'function').sort(([a],[b]) => a.localeCompare(b)));
      const context = digest([assignment,execution]);
      const previous = ledger.db.prepare('SELECT * FROM worker_turn_bindings WHERE request_key=?').get(requestKey);
      if (previous && previous.context_sha !== context) throw Error('Changed turn context requires reconciliation');
      const jobId = 'turn-' + requestKey;
      const job = ledger.enqueue({ id:jobId, bot:assignment.bot, thread:turn.thread, project:assignment.project,
        resource:assignment.desktop, resources:[assignment.workspace] });
      ledger.db.prepare('INSERT OR IGNORE INTO worker_turn_bindings VALUES (?,?,?)').run(requestKey,context,jobId);
      const stored = ledger.db.prepare('SELECT * FROM worker_turn_bindings WHERE request_key=?').get(requestKey);
      if (stored.context_sha !== context || stored.job_id !== jobId) throw Error('Conflicting concurrent turn binding');
      return { job, pool:assignment.pool, worker:assignment.worker, replay:!!previous };
    },
  };
}
