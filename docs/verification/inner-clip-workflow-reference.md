# Inner Clip workflow reference

## Evidence and scope

Reviewed the installed Grok Bot's locally cached Partnerships & Revenue and Email Triage conversations on 2026-11-24, with the user's authorization. These caches are partial historical records, not proof of current automation execution. Related email threads corroborate the draft and follow-up workflow. No emails were sent or mailbox state changed during this review.

## Behavior to reproduce in MausBot

- Chief of staff routes email triage and partnership work to the appropriate specialist and receives completion reports.
- Morning email triage before 9 AM Eastern, including weekends: identify actionable messages, deadlines, replies and follow-ups with links to the original messages. Keep personal and business contexts separate and attribute each client correctly.
- Daily partner pipeline: research suitable Inner Clip documentary partners, explain the fit, check prior correspondence and existing partner conflicts, and identify relevant contacts. Distinguish published or verified contact details from inferred addresses; never present guesses as verified.
- Keep compact relationship history: contact, organization, previous correspondence, current offer, pending draft, actual send status, next follow-up date, and replies or out-of-office dates.
- Prepare editable email drafts in chat with inbound message context, attachments, the sending account's signature preview, and clear destination/provider identity. The user reviews and presses Send. Research, drafting and scheduling do not authorize sending.
- Use normal capitalization, capitalized names and proper punctuation. Keep the voice conversational and slightly more formal than Slack. Older lowercase style guidance in the cache was explicitly superseded by the user's correction.
- Reconcile sent, discarded and superseded drafts before making another draft. Record a send only after confirmed delivery through the sending workflow; avoid duplicate outreach.
- Adjust follow-ups for replies, out-of-office dates and explicit stop conditions. Historical records show bounded follow-ups; confirm the intended current cadence before enabling recurring outreach drafts.

The cache contains named routines for morning email triage, a daily partner pipeline, and partner reply watch. Their existence in historical records does not establish that equivalent MausBot routines are configured or running.

## Acceptance checks for implementation

1. A read-only triage returns actionable items with original-message links and correct business ownership.
2. A prospect already contacted is recognized, with current relationship context and no duplicate cold outreach.
3. A draft contains the correct recipient, sender, inbound context and sender signature; edits persist and no message sends without the user's Send action.
4. A confirmed send updates history and follow-up eligibility; discarded drafts and out-of-office replies are handled distinctly.
5. Chief-of-staff delegation completes and reports back using saved permissions without repeat approval prompts for already authorized operations.

## Separate authorized reliability work still outstanding

Add canonical build/startup validation, persistent-storage checks, permission and memory restart regression gates, and post-deployment runtime identity and delegation checks. Reviewing this workflow does not complete or deploy those safeguards.

## Production configuration pass, November 24

Updated the existing Inner Clip email watch rather than creating a duplicate. Preserved its 30-minute, 7 AM–9 PM schedule, mailbox scope, previous-run context, and no-send/no-mailbox-change rules. Added email tone, supported composer fallback, signature provenance, duplicate prevention, bounded recovery coverage, checkpointing, and reporting to Atlas.

The manual 10:21 AM run completed at about 10:23 AM with actionable threads. The visible report recognized an already answered partnership thread and explicitly stated that in-chat composition and the saved signature were unavailable. It reported saving scoped memory and notifying Atlas; those two side effects have not been independently read back in this pass. No external send was requested. The run disclosed an uncovered historical interval instead of claiming full coverage.

Resumed the existing watch after that run. The production UI confirmed it was On, with the next occurrence at 10:38 AM Eastern.

Updated the existing daily 8 AM partnership routine with the same tone, relationship lifecycle, supported composer, signature and truthful completion requirements. Its prior recent runs show a success checkmark alongside “Usage Limit Reached”; treat that as a status-classification bug, not evidence that prospect research completed. No new successful partnership run has been verified in this pass.

Started a manual partnership run with the corrected instructions. Completion remains to be checked.

Implementation gap confirmed in source: composer email delivery uses the native email host. Connected Gmail/Outlook adapters and automatic provider signature-settings retrieval remain separate unfinished work. Do not claim that changing routine instructions implements those adapters.
