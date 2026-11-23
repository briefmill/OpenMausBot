import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { patchRuntime, prepareRepair, sha256 } from "./repair-production-full-access.mjs";

// Inspected production call-site structure, including its original policy bug.
const fixture = `
var ombReadBrainPolicy={};
var approvalModeForTurn=(bot,peerInitiated=!1,threadId=bot.threadId)=>{if(ombReadBrainPolicy)return"ask";if(cloudGuestDriven(threadId)||
botApiThread(threadId)||proactive.fence.confines(threadId))return"ask";let mode=approvalModeForOrigin(approvalModeFor(bot),{peerInitiated});return supportsApprovalMode2(bot.modelSelection,mode)?mode:"ask"};
function verdict(bot,tool,threadId=bot.threadId){const asker=bot,effectiveApprovalMode=liveApprovalMode(bot,threadId,false),ombReadDecision=ombReadBrainPolicy&&asker?"review":void 0;return autoVerdict(effectiveApprovalMode,tool,{readBrain:ombReadDecision});}
function botTurn(bot){const threadId=bot.threadId,commsDepth=0;return {strictToolApprovals:Boolean(ombReadBrainPolicy),approvalMode:approvalModeForTurn(
bot,commsDepth>0,threadId)};}
function roomTurn(turnApprovalMode){return {strictToolApprovals:Boolean(ombReadBrainPolicy),approvalMode:ombReadBrainPolicy?"ask":turnApprovalMode};}
function connector(bot){const sendsFreely=()=>approvalModeForTurn(bot)==="full",rpc={method:"tools/call"},outboundTool="SEND",ombExternalReview=Boolean(ombReadBrainPolicy&&rpc?.method==="tools/call"),fullAccess=!ombReadBrainPolicy&&(outboundTool!==null&&sendsFreely());return {review:ombExternalReview,full:fullAccess};}
globalThis.api={approvalModeForTurn,verdict,botTurn,roomTurn,connector};
`;

function run(source) {
  const context = {
    cloudGuestDriven: (id) => id === "guest", botApiThread: (id) => id === "api",
    proactive: { fence: { confines: (id) => id === "confined" } },
    approvalModeFor: (bot) => bot.approvalMode,
    approvalModeForOrigin: (mode) => mode, supportsApprovalMode2: () => true,
    autoVerdict: (mode, tool, context) => tool === "AskUserQuestion" ? "question" :
      context.readBrain !== undefined ? "review" : mode === "full" ? "full-access" : "review",
  };
  context.liveApprovalMode = (bot, threadId) => context.api.approvalModeForTurn(bot, false, threadId);
  vm.runInNewContext(source, context);
  return context.api;
}

test("qualified patch restores Full across requests, native turns, rooms and connector review", () => {
  const full = { approvalMode: "full", threadId: "own" };
  assert.equal(run(fixture).verdict(full, "Read"), "review");
  const api = run(patchRuntime(fixture, sha256(fixture)));
  for (const tool of ["Read", "Write", "Bash", "browser_click", "SEND_EMAIL"]) {
    assert.equal(api.verdict(full, tool), "full-access", tool);
  }
  assert.equal(api.botTurn(full).approvalMode, "full");
  assert.equal(api.botTurn(full).strictToolApprovals, false);
  assert.equal(api.roomTurn("full").strictToolApprovals, false);
  assert.equal(api.roomTurn("full").approvalMode, "full");
  assert.equal(api.connector(full).review, false);
  assert.equal(api.connector(full).full, true);
  // Per-request reads see revocation without a new turn or process restart.
  full.approvalMode = "ask";
  assert.equal(api.verdict(full, "Read"), "review");
  assert.equal(api.botTurn(full).strictToolApprovals, true);
  assert.equal(api.connector(full).review, true);
  assert.equal(api.connector(full).full, false);
});

test("questions, guest/API/proactive fences and non-Full policy stay intact", () => {
  const api = run(patchRuntime(fixture, sha256(fixture)));
  for (const mode of ["ask", "auto", "custom"]) {
    const bot = { approvalMode: mode, threadId: "own" };
    assert.equal(api.verdict(bot, "Read"), "review");
    assert.equal(api.botTurn(bot).approvalMode, "ask");
    assert.equal(api.roomTurn(mode).strictToolApprovals, true);
  }
  const full = { approvalMode: "full", threadId: "own" };
  assert.equal(api.verdict(full, "AskUserQuestion"), "question");
  for (const threadId of ["guest", "api", "confined"]) {
    assert.equal(api.approvalModeForTurn(full, false, threadId), "ask");
    assert.equal(api.verdict(full, "Read", threadId), "review");
  }
});

test("different bundles, missing hooks and duplicate hooks fail closed", () => {
  assert.throws(() => patchRuntime(fixture), /Unqualified/);
  const missing = fixture.replace('if(ombReadBrainPolicy)return"ask";', "");
  assert.throws(() => patchRuntime(missing, sha256(missing)), /exactly one turn mode/);
  const duplicate = fixture + 'if(ombReadBrainPolicy)return"ask";';
  assert.throws(() => patchRuntime(duplicate, sha256(duplicate)), /exactly one turn mode/);
});

test("prepares a separate, restartable package while preserving originals and integrity guards", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maus-full-repair-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "original"), repairRoot = path.join(root, "repair");
  fs.mkdirSync(path.join(sourceRoot, "candidate"), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, "provider-metadata"));
  const helper = "export const preserved=true;";
  const manifest = { candidateSHA256: sha256(fixture), metadataHelperSHA256: sha256(helper),
    archives: { "original.tgz": "preserved-archive-hash" }, guardFiles: [{ path: "/app/custom.mjs", sha256: "preserved-guard" }] };
  fs.writeFileSync(path.join(sourceRoot, "candidate/index.js"), fixture);
  fs.writeFileSync(path.join(sourceRoot, "provider-metadata/helpers.mjs"), helper);
  fs.writeFileSync(path.join(sourceRoot, "production-manifest.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(sourceRoot, "bootstrap.mjs"), `const root='${sourceRoot}';export {root};`);
  fs.writeFileSync(path.join(sourceRoot, "ui-before.json"), "preserved-ui-receipt");
  const options = { sourceRoot, repairRoot, expectedHash: sha256(fixture), expectedHelperHash: sha256(helper) };
  assert.equal(prepareRepair(options), repairRoot);
  assert.equal(fs.readFileSync(path.join(sourceRoot, "candidate/index.js"), "utf8"), fixture);
  const copied = JSON.parse(fs.readFileSync(path.join(repairRoot, "production-manifest.json"), "utf8"));
  assert.deepEqual(copied.archives, manifest.archives);
  assert.deepEqual(copied.guardFiles, manifest.guardFiles);
  assert.equal(fs.readFileSync(path.join(repairRoot, "ui-before.json"), "utf8"), "preserved-ui-receipt");
  assert.equal(copied.candidateSHA256, sha256(fs.readFileSync(path.join(repairRoot, "candidate/index.js"))));
  assert.equal(prepareRepair(options), repairRoot);
  fs.appendFileSync(path.join(repairRoot, "bootstrap.mjs"), "// drift");
  assert.throws(() => prepareRepair(options), /does not match reviewed patch/);
  fs.writeFileSync(path.join(sourceRoot, "ROLLBACK"), "");
  assert.throws(() => prepareRepair(options), /rollback mode/);
});
