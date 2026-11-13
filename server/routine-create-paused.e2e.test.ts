import { expect, it } from "vitest";
import { runControlOmb } from "../scripts/control-omb.ts";
import { launchRestartableServer } from "./testing/restartable-server.ts";

it("persists a newly created paused routine without a next run across restart", async () => {
  const server = await launchRestartableServer();
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${server.url}${path}`, {
      method, headers: { "content-type": "application/json", origin: server.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.ok).toBe(true);
    return await response.json() as any;
  };
  try {
    const result = await runControlOmb(["new-bot", "--name", "Paused fixture", "--url", server.url]) as { bot: { id: string } };
    const created = (await api("POST", "/api/routines", {
      name: "Paused setup fixture", prompt: "Synthetic fixture, no external actions.",
      botId: result.bot.id, enabled: false,
      schedule: { type: "once", at: Date.now() + 3_600_000 },
    })).routine;
    expect(created).toMatchObject({ enabled: false, nextRunAt: null });
    await server.stop();
    await server.start();
    const state = await api("GET", "/api/routines");
    expect(state.routines.find((r: any) => r.id === created.id)).toMatchObject({ enabled: false, nextRunAt: null });
    expect(state.runs.filter((r: any) => r.routineId === created.id)).toEqual([]);
  } finally {
    await server.close();
  }
}, 60_000);
