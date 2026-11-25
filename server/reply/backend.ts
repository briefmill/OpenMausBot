import { join } from "node:path";
import { createReplyDraftRoutes } from "../routes/reply-drafts.ts";
import { ReplyDraftStore } from "./store.ts";

type Bindings = Omit<Parameters<typeof createReplyDraftRoutes>[0], "store">;

export function createReplyBackend({ dataDir, ...bindings }: Bindings & { dataDir: string }) {
  if (!dataDir) throw new Error("The reply backend needs the existing workspace data directory");
  const store = new ReplyDraftStore(join(dataDir, "reply-drafts"));
  return { store, route: createReplyDraftRoutes({ ...bindings, store }) };
}
