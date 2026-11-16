import type { ModelCatalog, ProviderAdapter, ProviderDriver } from "../contracts.ts";

export interface WorkerPoolConfig { pool: string }
export interface WorkerHostBootstrap {
  pools: Readonly<Record<string, { models: ModelCatalog }>>;
  createAdapter(input: { instanceId: string; pool: string }): Promise<ProviderAdapter>;
  health(input: { instanceId: string; pool: string }): Promise<boolean>;
}

export function createWorkerDriver(host: WorkerHostBootstrap): ProviderDriver<WorkerPoolConfig> {
  const pools = structuredClone(host.pools);
  const ids = Object.keys(pools);
  if (!ids.length || ids.some(id => !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(id))) throw new Error("Invalid worker pools");
  for (const pool of Object.values(pools)) {
    if (!pool.models?.default || !Array.isArray(pool.models.options) || !pool.models.options.some(model => model.id === pool.models.default)) {
      throw new Error("Worker model catalog required");
    }
  }
  const decodeConfig = (raw: unknown): WorkerPoolConfig => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).join(",") !== "pool" ||
        !("pool" in raw) || typeof raw.pool !== "string" || !Object.hasOwn(pools, raw.pool)) {
      throw new Error("Choose a host-approved worker pool");
    }
    return { pool: raw.pool };
  };
  return {
    driverKind: "isolatedWorker",
    metadata: { displayName: "Isolated workers", supportsMultipleInstances: true, access: "custom" },
    models: structuredClone(pools[ids[0]].models),
    defaultConfig: () => ({ pool: ids[0] }),
    decodeConfig,
    async create(input) {
      const config = decodeConfig(input.config);
      if (Object.keys(input.environment).length) throw new Error("Worker environment overrides are forbidden");
      const adapter = await host.createAdapter({ instanceId: input.instanceId, pool: config.pool });
      if (adapter.provider !== "isolatedWorker") throw new Error("Worker adapter identity mismatch");
      return {
        instanceId: input.instanceId, driverKind: "isolatedWorker", displayName: input.displayName,
        enabled: input.enabled, models: structuredClone(pools[config.pool].models), adapter,
        snapshot: async () => await host.health({ instanceId: input.instanceId, pool: config.pool })
          ? { state: "available" } : { state: "unavailable", reason: "Worker pool has no verified capacity" },
        dispose: () => adapter.stopAll(),
      };
    },
  };
}
