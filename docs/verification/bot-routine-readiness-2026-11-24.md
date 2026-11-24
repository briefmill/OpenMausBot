# Bot routine readiness — November 24

## Verified versus outstanding

The production permission-repair receipt verifies saved Full Access, BVS model assignments, and a harmless Atlas-to-specialist memory delegation. It does not verify individual client routines, connected services, external delivery, or their schedules.

The Inner Clip workflow reference records one successful email-watch run and its resumed 30-minute daytime schedule. It records an updated daily partnership routine and a manual run awaiting completion; that is not proof of completed partner research. Email composer provider delivery and account signature retrieval remain unfinished.

No current BVS routine inventory or completed run evidence is present in these verification receipts. Do not infer readiness from a bot existing, a model assignment, an enabled schedule, or a completed provider turn alone.

## BVS readiness checklist

For each existing routine, capture its owner, purpose, enabled state, exact schedule and time zone, connected account/client scope, latest useful output, and unresolved blockers before editing it. Preserve existing schedules unless the user requested a change. Keep planning-only restrictions visible until an executable workflow and its scope are verified.

Each specialist needs a usable service connection, scoped persistent memory/checkpoint, duplicate prevention, bounded retries, and a completion report to Atlas. Atlas needs a report that distinguishes completed work, deferred work, user input, provider limits, and unavailable integrations. Around-the-clock availability is different from running every task continuously.

Partnership and message drafts remain review-before-send. Schedule changes do not authorize external outreach. Keep BVS and Inner Clip records separate, and retain source links and account identity in actionable reports.

## Historical success checks beside quota notices

The scheduler currently marks a bot routine complete only after a runtime `turn.completed` event reports `ok: true`. A failed completion is passed to recovery; structured quota facts choose usage-limit handling. A historical green check beside the words “Usage Limit Reached” therefore needs the original provider/event evidence: it may be an upstream normal-completion report carrying failure text, a legacy runtime, or an actual assistant quotation.

Do not classify arbitrary assistant prose as a provider quota error. A quoted notice can be valid task output. Capture the affected run's engine, runtime events, and deployed build before selecting a driver correction or migrating historical outcomes. Existing Antigravity outcome tests explicitly cover this false-positive risk.

## Remaining acceptance evidence

- Confirm the Inner Clip partnership manual run reaches a useful final result and reports to Atlas.
- Read back each BVS routine and account connection, then verify its permitted workflow with bounded, appropriate checks.
- Observe a scheduled occurrence as well as a manual run before declaring its schedule verified.
- Verify recovery produces a visible blocked/deferred outcome for provider quotas, and never calls that successful client work.
- Record any staging code change separately from production deployment and runtime verification.

## Isolated recovery check

Ran the existing `server/routine-recovery.e2e.test.ts` case “waits for a usage limit that says when it resets, instead of failing” against its isolated fake-engine fixture. It passed: the real server queued the run with a usage-limit retry and a deferred notification rather than completing it. The sandbox's first attempt could not open local ports; the permitted local-port run passed. This verifies the structured quota path in the checked-out source, not the historical production provider result.
