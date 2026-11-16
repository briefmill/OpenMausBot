// ProviderAdapter seam from server/contracts.ts. Trusted bootstrap supplies the
// adapter and callbacks; network job bodies cannot supply executables or env.
export async function runProviderTurn({ adapter, input, checkLease, forwardEvent, decidePermission,
  signal, maxEvents = 10_000, maxBuffered = 256, heartbeatMs = 1000, onRequestOutcome = async () => {} }) {
  if (input.approvalMode !== 'ask' || input.mcpFromUserConfig !== false ||
      !input.toolScope || typeof input.engineAdmission !== 'function' ||
      typeof input.approvalModeNow !== 'function' || typeof checkLease !== 'function' ||
      typeof forwardEvent !== 'function' || typeof decidePermission !== 'function' ||
      typeof input.botId !== 'string' || typeof input.threadId !== 'string')
    throw Error('Scoped controller callbacks and explicit ask mode required');
  if (!signal || typeof signal.addEventListener !== 'function') throw Error('Bounded execution signal required');
  if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs < 1 || heartbeatMs > 10_000) throw Error('Invalid heartbeat interval');
  let turnId, wake, closed = false, overflow = false, seen = 0, interrupted = false, dispatched = false;
  const queue = [], seenIds = new Set();
  const notify = () => { wake?.(); wake = undefined; };
  const unsubscribe = adapter.onEvent(event => {
    if (closed || event.threadId !== input.threadId) return;
    if (queue.length >= maxBuffered) overflow = true;
    else queue.push(event);
    notify();
  });
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  aborted.catch(() => {});
  const onAbort = () => { rejectAbort(Error('Execution uncertain: deadline or lease lost')); notify(); };
  signal.addEventListener('abort', onAbort);
  if (signal.aborted) onAbort();
  const bounded = promise => Promise.race([promise, aborted]);
  let checking;
  const timer = setInterval(() => { notify(); void active().catch(rejectAbort); }, heartbeatMs);
  const interrupt = async () => {
    if (!dispatched || interrupted) return;
    interrupted = true;
    // An ACK is not proof of process termination. The ledger remains held until
    // an authoritative terminal event or operator reconciliation.
    let stopTimer;
    try { await Promise.race([
      adapter.interruptTurn(input.threadId, turnId),
      new Promise((_, reject) => { stopTimer = setTimeout(() => reject(Error('Provider stop uncertain')), 1000); }),
    ]); } finally { clearTimeout(stopTimer); }
  };
  const active = async () => {
    if (signal.aborted) throw Error('Execution uncertain: deadline or lease lost');
    if (!checking) checking = Promise.resolve().then(checkLease).finally(() => { checking = undefined; });
    const state = await bounded(checking);
    if (state.cancellationRequested) await interrupt();
    return state;
  };
  try {
    const initial = await active();
    if (initial.cancellationRequested) throw Error('Cancelled before provider dispatch');
    // Older adapters do not call engineAdmission. Reserve conservatively before
    // dispatch rather than trusting the presence of an unused callback.
    if (adapter.capabilities?.engineAdmission !== true) {
      await bounded(input.engineAdmission('process'));
      if ((await active()).cancellationRequested) throw Error('Cancelled before provider dispatch');
    }
    dispatched = true;
    const started = await bounded(adapter.sendTurn(input));
    if (!started || typeof started.turnId !== 'string') throw Error('Provider did not acknowledge turn identity');
    turnId = started.turnId;
    while (true) {
      if (overflow) throw Error('Execution uncertain: event buffer overflow');
      await active();
      if (!queue.length) {
        await new Promise(resolve => { wake = resolve; if (signal.aborted || queue.length || overflow) notify(); });
        continue;
      }
      const event = queue.shift();
      if (event.turnId !== turnId) continue;
      if (typeof event.eventId !== 'string' || ++seen > maxEvents) throw Error('Execution uncertain: invalid event stream');
      if (seenIds.has(event.eventId)) continue;
      seenIds.add(event.eventId);
      // Preserve canonical tool identity and permission evidence. The trusted
      // controller must redact private fields before UI publication.
      await bounded(forwardEvent(event));
      if (event.type === 'request.opened') {
        if (typeof event.requestId !== 'string') throw Error('Permission request lacks identity');
        await active();
        const decision = interrupted ? { behavior: 'deny' } : await bounded(decidePermission(event));
        await active();
        if (!decision || !['allow', 'deny', 'answer'].includes(decision.behavior) || decision.always === true)
          throw Error('Invalid controller permission decision');
        const outcome = await bounded(adapter.respondToRequest(input.threadId, event.requestId, interrupted ? { behavior: 'deny' } : decision));
        if (!['allowed-once', 'rejected', 'answered', 'unavailable'].includes(outcome)) throw Error('Invalid provider acknowledgement');
        await bounded(onRequestOutcome(event, outcome));
      }
      if (event.type === 'turn.completed') return {
        turnId, ok: event.ok === true, cancelled: interrupted, events: seenIds.size,
        stopReason: event.stopReason ?? null,
      };
      if (event.type === 'cap.exhausted') return { turnId, ok: false, cancelled: interrupted, events: seenIds.size, stopReason: 'cap' };
    }
  } catch (error) {
    // Attempt cancellation, but do not claim completion or automatically retry.
    try { await interrupt(); } catch { }
    throw error;
  } finally {
    closed = true; clearInterval(timer); unsubscribe(); signal.removeEventListener('abort', onAbort);
  }
}
