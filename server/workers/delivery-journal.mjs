import { bindWorkerReplies } from './reply-store.mjs';
import { bindWorkerUsage } from './usage-book.mjs';
export function bindWorkerDelivery({ ledger,store,commandReceipt,jobId,generation,turnId,redactText }) {
  const reply=bindWorkerReplies({store,commandReceipt,getJob:id=>ledger.get(id),jobId,generation,redactText});
  const usage=bindWorkerUsage({ledger,jobId,generation,turnId});
  ledger.db.exec(`CREATE TABLE IF NOT EXISTS worker_event_cursors (
    job TEXT NOT NULL REFERENCES jobs(id),generation INTEGER NOT NULL,seq INTEGER NOT NULL,PRIMARY KEY(job,generation))`);
  const cursor=()=>ledger.db.prepare('SELECT seq FROM worker_event_cursors WHERE job=? AND generation=?').get(jobId,generation)?.seq??0;
  return {
    cursor,usageSummary:()=>usage.summary(),
    drain(limit=100) {
      if(ledger.get(jobId).generation!==generation)throw Error('Stale worker event delivery');
      const page=ledger.readEvents(jobId,cursor(),limit);
      // Usage receipts survive a later publication failure in another database.
      for(const row of page.events)if(row.event.type==='turn.completed')usage.record(row);
      let processed=0,recoveredReplies=0;
      for(const row of page.events) {
        const before=cursor();
        const job=ledger.get(jobId);
        if(row.event.threadId!==undefined&&row.event.threadId!==job.thread)throw Error('Foreign worker event');
        const delivered=row.event.type==='item.completed'&&row.event.itemType==='assistant_text'?reply(row):{};
        if(delivered.recovered)recoveredReplies++;
        ledger.transaction(()=>{
          if(cursor()!==before)throw Error('Concurrent worker delivery requires retry');
          ledger.db.prepare('INSERT INTO worker_event_cursors VALUES (?,?,?) ON CONFLICT(job,generation) DO UPDATE SET seq=excluded.seq')
            .run(jobId,generation,row.seq);
        });
        processed++;
      }
      return {processed,recoveredReplies,lastSeq:cursor(),hasMore:page.hasMore};
    },
  };
}
