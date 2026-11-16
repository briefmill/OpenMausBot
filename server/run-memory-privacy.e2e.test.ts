import { join } from "node:path";
import { expect, it } from "vitest";
import { launchCloudSendFixture } from "../scripts/testing/cloud-send-fixture.ts";
import { createRunMemoryLedger } from "./run-memory-ledger.ts";
import { hostTimeout } from "./testing/host-timeout.ts";

it(
  "keeps member and admin private memory reports out of other administrators' reads",
  async () => {
    const fx = await launchCloudSendFixture({
      onePasswordToken: "ops_fake-memory-privacy-only",
      team: {
        id: "team-memory-privacy",
        name: "Memory privacy fixture",
        noAi: true,
      },
    });
    try {
      const team = fx.team!;
      const owner = (
        await team.pair({ email: "owner@memory.test", role: "owner" })
      ).token!;
      const admin = (
        await team.pair({ email: "admin@memory.test", role: "admin" })
      ).token!;
      const member = (
        await team.pair({ email: "member@memory.test", role: "member" })
      ).token!;
      const created = await team.as(owner, "POST", "/api/bots", {
        name: "Memory privacy probe",
        visibility: "everyone",
      });
      expect(created.status).toBe(201);
      const bot = created.body.bot;
      const sharedThread = bot.mainThreadId ?? bot.threadId;
      expect(sharedThread).toBeTypeOf("string");
      const privateAdmin = await team.as(
        admin,
        "POST",
        `/api/bots/${bot.id}/tasks`,
        { title: "Admin private" },
      );
      const privateMember = await team.as(
        member,
        "POST",
        `/api/bots/${bot.id}/tasks`,
        { title: "Member private" },
      );
      expect(privateAdmin.status).toBe(201);
      expect(privateMember.status).toBe(201);
      const ledger = createRunMemoryLedger(join(team.home, ".openmausbot"));
      const at = Date.now() - 100;
      for (const [runId, threadId] of [
        ["shared-run", sharedThread],
        ["admin-private-run", privateAdmin.body.task.threadId],
        ["member-private-run", privateMember.body.task.threadId],
      ]) {
        ledger.record({
          runId,
          threadId,
          startedAt: at - 1,
          endedAt: at,
          sampledProcessGroupPeakBytes: 42,
          sharedProcess: false,
          samples: 1,
        });
      }
      await ledger.flush();
      const ownerRead = await team.as(owner, "GET", "/api/usage/memory");
      const adminRead = await team.as(admin, "GET", "/api/usage/memory");
      expect(ownerRead.status).toBe(200);
      expect(adminRead.status).toBe(200);
      expect(
        ownerRead.body.rows.map((row: { runId: string }) => row.runId),
      ).toEqual(["shared-run"]);
      expect(
        adminRead.body.rows.map((row: { runId: string }) => row.runId),
      ).toEqual(["shared-run", "admin-private-run"]);
      expect((await team.as(member, "GET", "/api/usage/memory")).status).toBe(
        403,
      );
    } finally {
      await fx.close();
    }
  },
  hostTimeout(120_000),
);
