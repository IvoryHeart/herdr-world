---
name: world-verify-change
description: Select and run Herdr World's relevant checks and record evidence for the candidate being delivered.
---

Use docs/agent-development.md for the check matrix. Run focused checks while
implementing and npm run check before committing. Browser/runtime changes need
check:acceptance and their relevant fixture scenarios. Release/vendoring changes
use their runbooks. Run npm run agent:verify -- <profile> to record a content
fingerprint, command results and logs. A previous result is stale after edits.
Never weaken checks to produce a green result; identify baseline failures precisely.
Do not connect acceptance tests to a user's live Herdr instance.
