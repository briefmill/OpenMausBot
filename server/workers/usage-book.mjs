import { createHash } from 'node:crypto';
const metric = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw Error('Invalid terminal token count');
  return value;
};
export function bindWorkerUsage({ ledger, jobId, generation, turnId }) {
  if (!Number.isSafeInteger(generation) || generation < 1 || typeof turnId !== 'string' || !turnId) throw Error('Trusted usage identity required');
  ledger.db.exec(`CREATE TABLE IF NOT EXISTS worker_usage (
    job TEXT NOT NULL REFERENCES jobs(id), generation INTEGER NOT NULL, seq INTEGER NOT NULL,
    digest TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(job,generation))`);
  return {
    record({ seq,event }) {
      const job=ledger.get(jobId);
      if (job.generation!==generation || event.threadId!==job.thread || event.turnId!==turnId || event.type!=='turn.completed')
        throw Error('Stale or foreign terminal usage');
      if (!Number.isSafeInteger(seq) || seq<1) throw Error('Invalid usage sequence');
      const persisted=ledger.db.prepare('SELECT body FROM events WHERE job=? AND seq=?').get(jobId,seq);
      if (!persisted || persisted.body!==JSON.stringify(event)) throw Error('Terminal usage lacks matching durable event');
      const usage=event.usage===undefined?null:{input:metric(event.usage.input),output:metric(event.usage.output),
        cachedInput:event.usage.cachedInput===undefined?null:metric(event.usage.cachedInput)};
      if (usage?.cachedInput!==null && usage?.cachedInput>usage?.input) throw Error('Cached tokens exceed input');
      const cost=event.cost===undefined||event.cost===null?null:event.cost;
      if (cost!==null&&(typeof cost!=='number'||!Number.isFinite(cost)||cost<0)) throw Error('Invalid terminal cost');
      const record={bot:job.bot,thread:job.thread,turnId,usage,costUsd:cost};
      const body=JSON.stringify(record),digest=createHash('sha256').update(body).digest('hex');
      return ledger.transaction(()=>{
        const previous=ledger.db.prepare('SELECT digest,body FROM worker_usage WHERE job=? AND generation=?').get(jobId,generation);
        if (previous) {
          if(previous.digest!==digest)throw Error('Conflicting terminal usage replay');
          return {recorded:false,recovered:true,usage:JSON.parse(previous.body)};
        }
        ledger.db.prepare('INSERT INTO worker_usage VALUES (?,?,?,?,?)').run(jobId,generation,seq,digest,body);
        return {recorded:true,recovered:false,usage:record};
      });
    },
    summary() {
      const bot=ledger.get(jobId).bot;
      const rows=ledger.db.prepare('SELECT u.body FROM worker_usage u JOIN jobs j ON j.id=u.job WHERE j.bot=?').all(bot).map(row=>JSON.parse(row.body));
      const unpricedTurns=rows.filter(row=>row.costUsd===null).length;
      const knownCostUsd=rows.reduce((sum,row)=>sum+(row.costUsd??0),0);
      return {turns:rows.length,knownCostUsd,unpricedTurns,totalCostUsd:unpricedTurns?null:knownCostUsd,
        knownInputTokens:rows.reduce((sum,row)=>sum+(row.usage?.input??0),0),
        knownOutputTokens:rows.reduce((sum,row)=>sum+(row.usage?.output??0),0),unmeasuredTurns:rows.filter(row=>row.usage===null).length};
    },
  };
}
