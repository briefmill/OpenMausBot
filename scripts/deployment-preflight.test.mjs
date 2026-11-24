import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { REQUIRED_CHECKS, verifyDeploymentReceipt } from "./deployment-preflight.mjs";

function fixture(fn) {
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omb-deploy-gate-"));
  try {
    fs.writeFileSync(path.join(evidenceRoot, "evidence.txt"), "Synthetic fixture evidence only");
    const now = Date.parse("2026-11-24T15:00:00Z");
    const expected = { buildCommit: "fixture-commit", runtimeSha256: "a".repeat(64), providerHelperSha256: "b".repeat(64), uiSha256: "c".repeat(64), extensionsSha256: "d".repeat(64), effectiveStartCommand: "node /data/reviewed/bootstrap.mjs", dataDirectory: "/data", volumeId: "fixture-volume" };
    const receipt = { schemaVersion: 1, environment: "staging", expected, observed: { ...expected, deploymentId: "fixture-deployment", deployedAt: "2026-11-24T14:00:00Z", health: "healthy", permissionPromptCount: 0 },
      checks: REQUIRED_CHECKS.map(name => ({ name, passed: true, deploymentId: "fixture-deployment", observedAt: "2026-11-24T14:30:00Z", path: "evidence.txt", sha256: createHash("sha256").update("Synthetic fixture evidence only").digest("hex") })) };
    fn(receipt, { evidenceRoot, now });
  } finally { fs.rmSync(evidenceRoot, { recursive: true, force: true }); }
}
test("only complete staging evidence makes the exact artifact eligible", () => fixture((r, opts) => {
  assert.equal(verifyDeploymentReceipt(r, opts).eligibleForProduction, true);
  r.environment = "production";
  assert.throws(() => verifyDeploymentReceipt(r, opts), /staging receipt/);
}));
test("healthy stale startup and missing persistence metadata fail closed", () => fixture((r, opts) => {
  for (const field of Object.keys(r.expected)) {
    const value = r.observed[field]; r.observed[field] = "wrong";
    assert.throws(() => verifyDeploymentReceipt(r, opts), /Runtime mismatch/);
    r.observed[field] = value;
  }
  delete r.expected.volumeId;
  assert.throws(() => verifyDeploymentReceipt(r, opts), /Missing/);
}));
test("missing, failed, stale or mismatched run evidence cannot pass", () => fixture((r, opts) => {
  const check = r.checks[0];
  for (const [key, value] of [["passed", false], ["deploymentId", "old"], ["observedAt", "2026-11-24T13:00:00Z"], ["sha256", "f".repeat(64)]]) {
    const old = check[key]; check[key] = value;
    assert.throws(() => verifyDeploymentReceipt(r, opts)); check[key] = old;
  }
  r.checks.pop(); assert.throws(() => verifyDeploymentReceipt(r, opts), /Missing or duplicate/);
}));
test("stale deployments, permission prompts and changed evidence are refused", () => fixture((r, opts) => {
  assert.throws(() => verifyDeploymentReceipt(r, { ...opts, now: opts.now + 2 * 86400000 }), /stale/);
  r.observed.permissionPromptCount = 1;
  assert.throws(() => verifyDeploymentReceipt(r, opts), /permission/);
  r.observed.permissionPromptCount = 0;
  fs.writeFileSync(path.join(opts.evidenceRoot, "evidence.txt"), "changed");
  assert.throws(() => verifyDeploymentReceipt(r, opts), /changed/);
}));
