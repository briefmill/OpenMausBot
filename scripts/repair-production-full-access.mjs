import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync, spawn } from "node:child_process";

export const SOURCE_ROOT = "/data/permission-fix-20261119";
export const REPAIR_ROOT = "/data/permission-fix-20261123-full-access";
export const QUALIFIED_SHA256 = "d47069b68af1e12afd308e3cfca2aa8ce1a33aadc003b5dcfa15c07bf2e07994";
export const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

// These are exact, inspected hooks in the separately deployed production bundle.
// Refuse a different bundle rather than silently patching a newer/custom runtime.
export const REPLACEMENTS = [
  ["turn mode", 'if(ombReadBrainPolicy)return"ask";', 'if(ombReadBrainPolicy&&approvalModeFor(bot)!=="full")return"ask";'],
  ["live verdict", "ombReadDecision=ombReadBrainPolicy&&asker?", 'ombReadDecision=ombReadBrainPolicy&&asker&&effectiveApprovalMode!=="full"?'],
  ["bot native permissions", "strictToolApprovals:Boolean(ombReadBrainPolicy),approvalMode:approvalModeForTurn(", 'strictToolApprovals:Boolean(ombReadBrainPolicy)&&liveApprovalMode(bot,threadId,commsDepth>0)!=="full",approvalMode:approvalModeForTurn('],
  ["room native permissions", 'strictToolApprovals:Boolean(ombReadBrainPolicy),approvalMode:ombReadBrainPolicy?"ask":turnApprovalMode', 'strictToolApprovals:Boolean(ombReadBrainPolicy)&&turnApprovalMode!=="full",approvalMode:ombReadBrainPolicy&&turnApprovalMode!=="full"?"ask":turnApprovalMode'],
  ["connector review", 'ombExternalReview=Boolean(ombReadBrainPolicy&&rpc?.method==="tools/call"', 'ombExternalReview=Boolean(ombReadBrainPolicy&&!sendsFreely()&&rpc?.method==="tools/call"'],
  ["connector full access", "fullAccess=!ombReadBrainPolicy&&(outboundTool!==null&&sendsFreely())", "fullAccess=(outboundTool!==null&&sendsFreely())"],
];

export function patchRuntime(source, expectedHash = QUALIFIED_SHA256) {
  if (sha256(source) !== expectedHash) throw new Error("Unqualified production runtime; no files changed");
  let patched = source;
  for (const [name, before, after] of REPLACEMENTS) {
    if (patched.split(before).length !== 2) throw new Error(`Expected exactly one ${name} hook; no files changed`);
    patched = patched.replace(before, after);
  }
  return patched;
}

export function prepareRepair({
  sourceRoot = SOURCE_ROOT, repairRoot = REPAIR_ROOT, expectedHash = QUALIFIED_SHA256,
  expectedHelperHash = "ba8c32d81d249f93e0fa1aa482958be7b1dfe6fee2ac0a78e2e5dd871ccd9b01",
} = {}) {
  if (fs.existsSync(`${sourceRoot}/ROLLBACK`)) throw new Error("Original package is in rollback mode; refusing repair");
  for (const relative of ["candidate/index.js", "production-manifest.json", "bootstrap.mjs"]) {
    if (!fs.lstatSync(`${sourceRoot}/${relative}`).isFile()) throw new Error("Repair inputs must be regular files");
  }
  const original = fs.readFileSync(`${sourceRoot}/candidate/index.js`, "utf8");
  const patched = patchRuntime(original, expectedHash);
  const manifest = JSON.parse(fs.readFileSync(`${sourceRoot}/production-manifest.json`, "utf8"));
  if (manifest.candidateSHA256 !== sha256(original)) throw new Error("Original manifest/runtime mismatch");
  const loadedHelper = fs.readFileSync(`${sourceRoot}/provider-metadata/helpers.mjs`);
  if (sha256(loadedHelper) !== expectedHelperHash ||
      manifest.metadataHelperSHA256 !== sha256(loadedHelper)) throw new Error("Original loaded helper mismatch");
  const expectedPatchedHash = sha256(patched);
  manifest.candidateSHA256 = expectedPatchedHash;
  const manifestText = JSON.stringify(manifest, null, 2);
  const bootstrap = fs.readFileSync(`${sourceRoot}/bootstrap.mjs`, "utf8");
  const declaration = `const root='${sourceRoot}'`;
  if (bootstrap.split(declaration).length !== 2) throw new Error("Unrecognized bootstrap root declaration");
  const patchedBootstrap = bootstrap.replace(declaration, `const root='${repairRoot}'`);
  if (fs.existsSync(repairRoot)) {
    const receipt = JSON.parse(fs.readFileSync(`${repairRoot}/full-access-repair.json`, "utf8"));
    if (receipt.before !== sha256(original) || receipt.after !== expectedPatchedHash ||
        sha256(fs.readFileSync(`${repairRoot}/candidate/index.js`)) !== expectedPatchedHash ||
        sha256(fs.readFileSync(`${repairRoot}/bootstrap.mjs`)) !== sha256(patchedBootstrap) ||
        sha256(fs.readFileSync(`${repairRoot}/production-manifest.json`)) !== sha256(manifestText)) {
      throw new Error("Existing repair does not match reviewed patch");
    }
  } else {
    const staging = `${repairRoot}.building-${process.pid}`;
    fs.cpSync(sourceRoot, staging, { recursive: true, force: false, errorOnExist: true });
    for (const relative of ["candidate/index.js", "production-manifest.json", "bootstrap.mjs"]) {
      if (!fs.lstatSync(`${staging}/${relative}`).isFile()) throw new Error("Repair copies must be regular files");
    }
    fs.writeFileSync(`${staging}/candidate/index.js`, patched);
    fs.writeFileSync(`${staging}/production-manifest.json`, manifestText, { mode: 0o600 });
    fs.writeFileSync(`${staging}/bootstrap.mjs`, patchedBootstrap);
    execFileSync(process.execPath, ["--check", `${staging}/candidate/index.js`], { stdio: "pipe" });
    execFileSync(process.execPath, ["--check", `${staging}/bootstrap.mjs`], { stdio: "pipe" });
    fs.writeFileSync(`${staging}/full-access-repair.json`, JSON.stringify({
      before: sha256(original), after: expectedPatchedHash,
      hooks: REPLACEMENTS.map(([name]) => name), originalPackagePreserved: true,
    }, null, 2), { mode: 0o600 });
    fs.renameSync(staging, repairRoot);
  }
  return repairRoot;
}

export async function launchRepair() {
  if (process.env.RAILWAY_SERVICE_ID !== "49381fa6-7f73-4936-a833-0c381c3909ce" ||
      process.env.RAILWAY_ENVIRONMENT_ID !== "44938670-9266-4d80-9b57-359692469a6b") {
    throw new Error("Production repair scope mismatch");
  }
  const root = prepareRepair();
  // The original bootstrap still verifies archives, UI trees and custom extensions.
  // No state, browser profiles, model configuration or client data is rewritten.
  const argv = [process.execPath, `${root}/bootstrap.mjs`];
  if (typeof process.execve === "function") process.execve(process.execPath, argv, process.env);
  else {
    const child = spawn(process.execPath, argv.slice(1), { stdio: "inherit", env: process.env });
    for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
    child.on("exit", (code) => process.exit(code ?? 1));
  }
}
