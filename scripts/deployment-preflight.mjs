import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const REQUIRED_CHECKS = [
  "permission-regression-tests", "tool-calling-regression-tests", "memory-restart-tests",
  "saved-full-access-readback", "native-tool-read-write", "chief-specialist-report",
  "memory-after-restart", "browser-profile-after-restart", "composer-review-only",
];
const HASH = /^[a-f0-9]{64}$/;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const required = (value, name) => { if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${name}`); return value; };

/** Validates supplied evidence, not the remote application. Operators must collect runtime observations independently. */
export function verifyDeploymentReceipt(receipt, { evidenceRoot, now = Date.now(), maxAgeMs = 24 * 60 * 60_000 } = {}) {
  if (receipt?.schemaVersion !== 1 || !["staging", "production"].includes(receipt.environment)) throw new Error("Unsupported deployment receipt");
  const expected = receipt.expected, observed = receipt.observed;
  for (const key of ["buildCommit", "runtimeSha256", "providerHelperSha256", "uiSha256", "extensionsSha256", "effectiveStartCommand", "dataDirectory", "volumeId"]) {
    required(expected?.[key], `expected.${key}`);
    if (key.endsWith("Sha256") && !HASH.test(expected[key])) throw new Error(`Invalid ${key}`);
    if (observed?.[key] !== expected[key]) throw new Error(`Runtime mismatch: ${key}`);
  }
  required(observed?.deploymentId, "deploymentId");
  const deployedAt = Date.parse(observed.deployedAt);
  if (!Number.isFinite(deployedAt) || deployedAt > now || now - deployedAt > maxAgeMs) throw new Error("Deployment evidence is stale or invalid");
  if (observed.health !== "healthy" || observed.permissionPromptCount !== 0) throw new Error("Runtime health or permission verification failed");
  const root = fs.realpathSync(required(evidenceRoot, "evidenceRoot"));
  const inspect = item => {
    if (item?.passed !== true || item.deploymentId !== observed.deploymentId) throw new Error("Evidence did not pass on this deployment");
    const at = Date.parse(item.observedAt);
    if (!Number.isFinite(at) || at < deployedAt || at > now) throw new Error("Evidence predates deployment or has invalid time");
    if (!HASH.test(item.sha256 ?? "")) throw new Error("Invalid evidence hash");
    const file = fs.realpathSync(path.resolve(root, required(item.path, "evidence path")));
    if (!file.startsWith(root + path.sep) || !fs.statSync(file).isFile()) throw new Error("Evidence must be a file inside evidenceRoot");
    const bytes = fs.readFileSync(file);
    if (!bytes.length || digest(bytes) !== item.sha256) throw new Error("Missing or changed evidence");
  };
  for (const check of REQUIRED_CHECKS) {
    const items = receipt.checks?.filter(item => item.name === check) ?? [];
    if (items.length !== 1) throw new Error(`Missing or duplicate check: ${check}`);
    inspect(items[0]);
  }
  if (receipt.environment === "production") throw new Error("Use a verified staging receipt to authorize promotion; collect production verification separately");
  return { schemaVersion: 1, eligibleForProduction: true, environment: "staging", deploymentId: observed.deploymentId,
    artifact: Object.fromEntries(["buildCommit", "runtimeSha256", "providerHelperSha256", "uiSha256", "extensionsSha256"].map(key => [key, expected[key]])),
    verifiedAt: new Date(now).toISOString(), receiptSha256: digest(JSON.stringify(receipt)),
    limitation: "Evidence integrity checked; no remote probe or deployment performed. Promote exactly this artifact and verify production effective startup and persistent volume before accepting it." };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const file = path.resolve(required(process.argv[2], "receipt JSON path"));
    console.log(JSON.stringify(verifyDeploymentReceipt(JSON.parse(fs.readFileSync(file, "utf8")), { evidenceRoot: path.dirname(file) }), null, 2));
  } catch (error) { console.error(`Deployment refused: ${error.message}`); process.exitCode = 1; }
}
