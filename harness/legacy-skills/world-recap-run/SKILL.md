---
name: world-recap-run
description: Explain a background harness run's progress, recover orientation after compaction, or assess a reported stall using its saved recap and targeted evidence.
---

Read the [background supervision procedure](../../../docs/agent-development.md#background-supervision).
Use `npm run agent:job -- recap JOB_ID` for a current read-only snapshot, or the job's
private `recap.json` for its last scheduled observation. State its timestamp. The
supervisor records every five minutes and at job exit without a model observer.

Give a short recap: goal/current phase; last completed outcome; active work and elapsed
time; unresolved findings or blockers; next action; material usage or reserve changes.
Call out missing/stale data. Do not paste token ledgers or repeat unchanged history.
After compaction, recover the brief and last relevant handoff, then inspect only the
source/evidence needed to resolve a concrete gap. A recap is not acceptance evidence.

Distinguish slow active work, human waiting, infrastructure failure and repeated code
findings. Silence or a changed fingerprint alone proves neither failure nor progress.
Escalate a material decision, repeated unresolved issue or exhausted allowance; routine
progress does not need another agent or a restart. The inner lead owns governor decisions.

Use available host events for user-facing updates, normally about five minutes apart,
and relay completion or a material blocker promptly. This skill cannot schedule or wake
a session: without host integration, expose the job/recap and return. Do not simulate a
notification system by repeated model polling, or assume permission to message elsewhere.
