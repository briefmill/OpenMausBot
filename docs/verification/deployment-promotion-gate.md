# Staging-to-production promotion gate

Run `node scripts/deployment-preflight.mjs /absolute/path/staging-receipt.json` after collecting staging evidence. Exit status 1 refuses promotion. Exit status 0 produces an eligibility receipt for the exact tested artifact; it does not deploy or assert remote facts.

The receipt is version 1 with `environment: "staging"`, `expected`, `observed`, and `checks`. Independently review the expected build commit, runtime/provider-helper/UI/extension SHA256 hashes, exact effective start command, persistent data directory, and volume identity. `observed` must match each expected field and include the actual deployment ID, deployment time, `health: "healthy"`, and `permissionPromptCount: 0`.

Read the effective deployment's start command, not only saved service settings. The November 23 production repair showed that ordinary Railway redeploy can reuse an old healthy launch snapshot. Never substitute that health check for runtime identity. Do not overwrite the repaired production runtime with an unqualified source build.

Each required check needs exactly one entry with its name, `passed: true`, the same deployment ID, an observation time after deployment, and a relative evidence file path plus its SHA256. Evidence must exist within the receipt directory, be nonempty, and match its hash. Receipts older than 24 hours, future dates, changed files, missing checks, and mismatches fail closed.

Required names are exported by `REQUIRED_CHECKS` in the script:

- permission-regression-tests
- tool-calling-regression-tests
- memory-restart-tests
- saved-full-access-readback
- native-tool-read-write
- chief-specialist-report
- memory-after-restart
- browser-profile-after-restart
- composer-review-only

Use isolated fixtures for mutation tests. Staging live checks must use diagnostic bot-owned files and no external communications, client publishing, spending, or credential changes. The restart checks require actual post-restart observations, not a pre-restart test renamed as proof. Test the existing permission repair, own-memory chains, CLI thread/model pinning, and applicable provider tool paths. Preserve the existing UI and custom extensions and record their actual artifact hashes.

The script validates evidence completeness, binding, freshness, and integrity. It cannot prove an operator's assertion is truthful or collect credentials, logs, hashes, or remote snapshots itself. Do not fill missing checks with placeholders. An eligibility receipt is a review gate, not an automatic proof of application correctness.

Promote only the artifact identity emitted by the gate. Production has its own expected startup, persistent data path, and volume; do not copy staging volume settings. After promotion, independently compare the effective production deployment and runtime against the reviewed target and repeat harmless permission/delegation/readback checks. Accept production only after those checks; preserve a reviewed rollback package and use the saved-configuration deployment operation when changing startup. The script deliberately rejects a production receipt as authorization to skip staging.
