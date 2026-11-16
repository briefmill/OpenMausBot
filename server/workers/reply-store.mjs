export function bindWorkerReplies({ store, commandReceipt, getJob, jobId, generation, redactText }) {
  if (![commandReceipt,getJob,redactText].every(value => typeof value === 'function') ||
      typeof jobId !== 'string' || !Number.isSafeInteger(generation) || generation < 1) throw Error('Trusted reply destination required');
  return ({ seq, event }) => {
    const job = getJob(jobId);
    if (job.id !== jobId || job.generation !== generation || !['running','completed'].includes(job.state) ||
        store.botByThread(job.thread)?.id !== job.bot || event.threadId !== job.thread) throw Error('Stale or foreign worker reply');
    if (!Number.isSafeInteger(seq) || seq < 1) throw Error('Invalid reply sequence');
    if (event.type !== 'item.completed' || event.itemType !== 'assistant_text') return { delivered:false };
    if (typeof event.text !== 'string' || !event.text.trim()) throw Error('Worker reply text required');
    const text = redactText(event.text);
    if (typeof text !== 'string' || !text.trim()) throw Error('Redacted worker reply text required');
    const command = { kind:'worker.reply',key:JSON.stringify([job.id,generation,seq,job.bot,job.thread]) };
    const previous = commandReceipt(command.kind,command.key);
    if (previous) {
      if (previous.result.text !== text) throw Error('Conflicting worker reply replay');
      return { delivered:true,reportId:previous.result.id,recovered:true };
    }
    const message = store.appendMessage(job.thread,{role:'bot',kind:'text',text,turnId:event.turnId},command);
    return { delivered:true,reportId:message.id,recovered:false };
  };
}
