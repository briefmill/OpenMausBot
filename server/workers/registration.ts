import type { AnyProviderDriver } from "../contracts.ts";
import { createWorkerDriver, type WorkerHostBootstrap } from "./driver.ts";

export function withWorkerDriver(drivers: readonly AnyProviderDriver[], host?: WorkerHostBootstrap): readonly AnyProviderDriver[] {
  if (!host) return drivers;
  if (drivers.some(driver => driver.driverKind === "isolatedWorker")) throw new Error("Worker driver already registered");
  return [...drivers, createWorkerDriver(host)];
}
