import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

/** Sampled controller engine-group memory, not an additive per-bot allocation or model API memory. */
export interface RunMemoryReport {
  runId: string;
  threadId: string;
  turnId?: string;
  startedAt: number;
  endedAt: number;
  sampledProcessGroupPeakBytes: number | null;
  sharedProcess: boolean;
  samples: number;
}

export function createRunMemoryLedger(
  dataDir: string,
  failed: () => void = () => console.warn("run-memory ledger write failed"),
) {
  let pending = Promise.resolve();
  return {
    record(report: RunMemoryReport): void {
      const month = new Date(report.endedAt).toISOString().slice(0, 7);
      const line =
        JSON.stringify({
          ...report,
          measurement: "sampled-process-group",
          additive: false,
        }) + "\n";
      pending = pending
        .then(async () => {
          const dir = join(dataDir, "run-memory");
          await mkdir(dir, { recursive: true, mode: 0o700 });
          await appendFile(join(dir, month + ".jsonl"), line, { mode: 0o600 });
        })
        .catch(() => {
          try {
            failed();
          } catch {}
        });
    },
    flush(): Promise<void> {
      return pending;
    },
  };
}

/** Bounded operator read. An incomplete scan is explicit rather than an apparent complete total. */
export async function readRunMemory(
  dataDir: string,
  range: { from: Date; to: Date },
  visible: (threadId: string) => boolean,
  page: { cursor?: string; limit?: number } = {},
) {
  const { open } = await import("node:fs/promises");
  const rows: RunMemoryReport[] = [];
  let budget = 8 * 1024 * 1024;
  const cursor = new Date(
    Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), 1),
  );
  const limit = page.limit ?? 1000;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new RangeError("invalid memory page limit");
  let resumeOffset = 0;
  if (page.cursor !== undefined) {
    const match = /^(\d{4}-(?:0[1-9]|1[0-2])):(\d{1,15})$/.exec(page.cursor);
    if (!match) throw new RangeError("invalid memory cursor");
    const month = new Date(match[1] + "-01T00:00:00.000Z");
    const last = Date.UTC(range.to.getUTCFullYear(), range.to.getUTCMonth(), 1);
    if (
      month.getTime() < cursor.getTime() ||
      month.getTime() > last ||
      !Number.isSafeInteger(Number(match[2]))
    )
      throw new RangeError("memory cursor outside range");
    cursor.setTime(month.getTime());
    resumeOffset = Number(match[2]);
  }
  const endMonth = Date.UTC(
    range.to.getUTCFullYear(),
    range.to.getUTCMonth(),
    1,
  );
  while (cursor.getTime() <= endMonth) {
    if (budget <= 0)
      return {
        rows,
        truncated: true,
        next: cursor.toISOString().slice(0, 7) + ":" + resumeOffset,
      };
    let handle;
    try {
      handle = await open(
        join(
          dataDir,
          "run-memory",
          cursor.toISOString().slice(0, 7) + ".jsonl",
        ),
        "r",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (handle) {
      try {
        const size = (await handle.stat()).size;
        if (resumeOffset > size)
          throw new RangeError("memory cursor beyond file");
        if (resumeOffset) {
          const preceding = Buffer.alloc(1);
          await handle.read(preceding, 0, 1, resumeOffset - 1);
          if (preceding[0] !== 10)
            throw new RangeError("memory cursor is not a record boundary");
        }
        const wanted = Math.min(size - resumeOffset, budget);
        const buffer = Buffer.alloc(wanted);
        let offset = 0;
        while (offset < wanted) {
          const { bytesRead } = await handle.read(
            buffer,
            offset,
            wanted - offset,
            resumeOffset + offset,
          );
          if (!bytesRead) break;
          offset += bytesRead;
        }
        budget -= offset;
        let consumed = 0;
        while (consumed < offset) {
          const newline = buffer.indexOf(10, consumed);
          if (newline < 0 || newline >= offset) break;
          const line = buffer.subarray(consumed, newline).toString("utf8");
          consumed = newline + 1;
          let row: RunMemoryReport;
          try {
            row = JSON.parse(line);
          } catch {
            continue;
          }
          if (
            !row ||
            typeof row !== "object" ||
            typeof row.runId !== "string" ||
            typeof row.threadId !== "string" ||
            !Number.isFinite(row.startedAt) ||
            !Number.isFinite(row.endedAt) ||
            row.startedAt > row.endedAt ||
            !(
              row.sampledProcessGroupPeakBytes === null ||
              (Number.isFinite(row.sampledProcessGroupPeakBytes) &&
                row.sampledProcessGroupPeakBytes >= 0)
            ) ||
            typeof row.sharedProcess !== "boolean" ||
            !Number.isSafeInteger(row.samples) ||
            row.samples < 0
          )
            continue;
          if (
            row.endedAt < range.from.getTime() ||
            row.endedAt > range.to.getTime() ||
            !visible(row.threadId)
          )
            continue;
          rows.push({
            runId: row.runId,
            threadId: row.threadId,
            ...(typeof row.turnId === "string" ? { turnId: row.turnId } : {}),
            startedAt: row.startedAt,
            endedAt: row.endedAt,
            sampledProcessGroupPeakBytes: row.sampledProcessGroupPeakBytes,
            sharedProcess: row.sharedProcess,
            samples: row.samples,
          });
          if (rows.length >= limit)
            return {
              rows,
              truncated: true,
              next:
                cursor.toISOString().slice(0, 7) +
                ":" +
                (resumeOffset + consumed),
            };
        }
        if (resumeOffset + offset < size)
          return {
            rows,
            truncated: true,
            ...(consumed
              ? {
                  next:
                    cursor.toISOString().slice(0, 7) +
                    ":" +
                    (resumeOffset + consumed),
                }
              : {}),
          };
      } finally {
        await handle.close();
      }
    }
    resumeOffset = 0;
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return { rows, truncated: false };
}
