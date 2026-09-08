---
name: world-verify-change
description: Select and run Herdr World's relevant checks and record evidence for the candidate being delivered.
---

Use docs/agent-development.md for the check matrix. Run focused checks while editing.
Pair partners hand complete suites to the deterministic verifier after agreement; do not
reinstall or repeat those suites inside model turns. Browser/runtime changes require the
acceptance profile and relevant fixture behavior. Release/vendoring changes use their runbooks.

Before committing, required checks must have passed for the current contents. A pair run's
matching receipt already satisfies this: a content-identical commit or PR publication does
not require another full sweep. Missing/stale evidence or interactive development uses
npm run agent:verify -- <profile> to record the fingerprint, command results and logs.
Any actual source change needs current evidence. Never weaken checks to manufacture a pass;
identify baseline failures precisely. Do not connect tests to a live deployment without
explicit authorization.
