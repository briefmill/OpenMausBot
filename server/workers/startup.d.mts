import type { WorkerHostBootstrap } from './driver.ts';
import type { VpsCommandRunner } from '../vps-command.ts';

export interface WorkerStartup {
  bootstrap: WorkerHostBootstrap;
  close(): Promise<void>;
}
export function loadConfiguredWorkerStartup(options: {
  configFile?: string;
  dataDir: string;
  resolveTurn(bot: string, thread: string): { bot?: string; thread: string; requestId?: string; active: boolean };
  run: VpsCommandRunner;
  route(alias: string, args: string[]): string[];
}): Promise<WorkerStartup | null>;
