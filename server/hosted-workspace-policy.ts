import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DATA_DIR } from "./config.ts";

export interface WorkspaceBinding { botId: string; policy: unknown }
interface PolicyAdapter {
  bvsAccountBinding(bot: object, raw?: string): WorkspaceBinding | undefined;
  scopedAccountCallProblem(policy: unknown, payload: unknown): string | null;
  fileScopedSessionCache(path: string): unknown;
  createScopedSessionManager(options: { baseUrl: string; trustedUrl(url: string): boolean; cache: unknown }): (key: string, user: string, botId: string, policy: unknown) => Promise<{mcp: {url: string}}>;
}
const enabled = Boolean(process.env.OMB_BVS_ACCOUNT_POLICIES || process.env.OMB_DEPARTMENT_ACCOUNT_POLICIES);
const adapterPath = `${DATA_DIR}/account-scope-20261114/monitoring-project-adapter-v12-github.mjs`;
let adapter: PolicyAdapter | undefined;
if (enabled) {
  const hash = createHash("sha256").update(readFileSync(adapterPath)).digest("hex");
  if (hash !== "e8c9d20f952e9440aa48138e1f52bc1cc1614aa2616fe72a71479f42a3033dcf") throw Error("Workspace account policy integrity mismatch");
  adapter = await import(pathToFileURL(adapterPath).href) as PolicyAdapter;
}
export function workspaceAccountBinding(bot: object): WorkspaceBinding | undefined {
  return adapter?.bvsAccountBinding(bot, process.env.OMB_BVS_ACCOUNT_POLICIES);
}
export function workspaceAccountCallProblem(binding: WorkspaceBinding | undefined, payload: unknown): string | null {
  return binding && adapter ? adapter.scopedAccountCallProblem(binding.policy, payload) : null;
}
const managers = new Map<string, ReturnType<PolicyAdapter["createScopedSessionManager"]>>();
export async function workspaceAccountSession(binding: WorkspaceBinding, baseUrl: string, key: string, user: string, trustedUrl: (url: string) => boolean) {
  if (!adapter) throw Error("Workspace account policy is unavailable");
  let manager = managers.get(baseUrl);
  if (!manager) { manager = adapter.createScopedSessionManager({ baseUrl, trustedUrl, cache: adapter.fileScopedSessionCache(`${DATA_DIR}/composio-scoped-sessions.json`) }); managers.set(baseUrl, manager); }
  return manager(key, user, binding.botId, binding.policy);
}

let routineGrant: ((event: unknown, bot: unknown, run: unknown, routines: unknown[]) => boolean) | undefined;
if (enabled) {
  const path = `${DATA_DIR}/account-scope-20261114/monitoring-routine-grant-v13.mjs`;
  if (createHash("sha256").update(readFileSync(path)).digest("hex") !== "ac35e11df27721813f9598eba2ec571e76110e9c080f80c027f57d226b569aa3") throw Error("Monitoring routine policy integrity mismatch");
  const module = await import(pathToFileURL(path).href) as { createMonitoringRoutineGrant(): NonNullable<typeof routineGrant> };
  routineGrant = module.createMonitoringRoutineGrant();
}
export function workspaceRoutineGrant(event: unknown, bot: unknown, run: unknown, routines: unknown[]): boolean {
  return routineGrant?.(event, bot, run, routines) ?? false;
}

interface DesktopAdapter {
  AGENT_DESKTOP_TOOLS: Array<{name:string;description:string;inputSchema:{type:string;properties:Record<string,unknown>;required:string[];additionalProperties:boolean}}>;
  isAgentDesktopTool(name: unknown): boolean;
  agentDesktopCallProblem(name: unknown, args: unknown): string | null;
  agentDesktopCommand(name: string, args: Record<string,unknown>): string;
  agentDesktopOutput(stdout: string, stderr: string, ok: boolean): {isError:boolean;text:string};
}
export let workspaceDesktopAdapter: DesktopAdapter | undefined;
if (enabled) {
  const path = `${DATA_DIR}/agent-desktop-20261114/adapter.mjs`;
  if (createHash("sha256").update(readFileSync(path)).digest("hex") !== "31560ce590edf526155b87fab599f2186098c335f5af09eadb09ab418bf03349") throw Error("Desktop adapter integrity mismatch");
  workspaceDesktopAdapter = await import(pathToFileURL(path).href) as DesktopAdapter;
}
