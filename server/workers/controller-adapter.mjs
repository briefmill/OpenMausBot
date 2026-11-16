// Controller-side adapter boundary. Trusted submit owns dispatch and translates
// provider input; this module never serializes callbacks or host credentials.
export function createWorkerAdapter({ provider, submit, cancel, answer, capabilities = {} }) {
  if (![submit, cancel, answer].every(fn => typeof fn === 'function')) throw Error('Trusted dispatch callbacks required');
  const listeners = new Set(), active = new Map();
  const emit = event => { for (const listener of listeners) listener(event); };
  return {
    provider,
    // Steer and native session continuity are not implemented by this bridge.
    capabilities: { ...capabilities, sessionModelSwitch: 'unsupported', queueing: false, strictResume: false },
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    hasSession() { return false; },
    async sendTurn(input) {
      if (active.has(input.threadId)) throw Error('Thread already owns a worker turn');
      const binding = { turnId: null, pending: new Set(), answering: new Set(), deliveries: new Set(), buffered: [], overflow: false }; active.set(input.threadId, binding);
      const publish = event => {
        if (binding.turnId !== event.turnId) return;
        if (event.type === 'request.opened') binding.pending.add(event.requestId);
        emit({...event,provider});
      };
      try {
        const started = await submit(input, event => {
          if (active.get(input.threadId) !== binding || event.threadId !== input.threadId ||
              typeof event.turnId !== 'string') return;
          if (binding.turnId === null) {
            if (binding.buffered.length >= 256) binding.overflow = true;
            else binding.buffered.push(structuredClone(event));
            return;
          }
          publish(event);
        });
        if (!started || typeof started.turnId !== 'string' || !started.completion ||
            typeof started.completion.then !== 'function') throw Error('Invalid worker dispatch acknowledgement');
        binding.turnId = started.turnId;
        if (binding.overflow) throw Error('Worker startup event buffer exceeded');
        for (const event of binding.buffered) publish(event);
        binding.buffered.length = 0;
        // completion means host-stop verification and artifact settlement, not
        // merely a provider terminal event. Do not free the thread on events.
        binding.completion = Promise.resolve(started.completion).then(async result => {
          if (result?.settled !== true) throw Error('Worker settlement unverified');
          await Promise.allSettled([...binding.deliveries]);
          if (active.get(input.threadId) === binding) active.delete(input.threadId);
          return result;
        });
        binding.completion.catch(() => {});
        return { turnId: binding.turnId };
      } catch (error) {
        // Failed startup may have partially launched. Keep this thread fenced
        // until the trusted host proves cancellation settled.
        binding.startupFailed = true;
        throw error;
      }
    },
    async respondToRequest(threadId, requestId, decision) {
      const binding = active.get(threadId);
      if (!binding || !binding.turnId || !binding.pending.has(requestId) || binding.answering.has(requestId) || decision?.always === true) return 'unavailable';
      binding.answering.add(requestId);
      const delivery = Promise.resolve().then(() => answer({ threadId, turnId: binding.turnId, requestId, decision }));
      binding.deliveries.add(delivery);
      try {
        const outcome = await delivery;
        if (active.get(threadId) !== binding) return 'unavailable';
        if (['allowed-once', 'rejected', 'answered'].includes(outcome)) binding.pending.delete(requestId);
        return outcome;
      } finally { binding.answering.delete(requestId); binding.deliveries.delete(delivery); }
    },
    async interruptTurn(threadId, turnId) {
      const binding = active.get(threadId);
      if (!binding || (turnId !== undefined && turnId !== binding.turnId)) return;
      const stopped = await cancel({ threadId, turnId: binding.turnId });
      if (stopped === true && active.get(threadId) === binding) active.delete(threadId);
    },
    async stopAll() { await Promise.all([...active.keys()].map(thread => this.interruptTurn(thread))); },
  };
}
