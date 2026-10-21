---
name: upstream-integration
description: Integrate a frozen Roamgate source release into Herdr World, or repair its existing sync PR without advancing the upstream target.
---

# Upstream integration

Read the current repository instructions, UPSTREAM.md, the relevant knowledge-map
rows and affected source/tests. Use the recorded Roamgate SHA as the merge baseline;
integrate the exact target supplied by the workflow, never a moving branch or tag.
The prepared merge retains upstream ancestry. Resolve conflicts explicitly, keeping
World's connection/generation qualification, one-origin service architecture,
identity, storage isolation, packaging and existing browser evidence.

UPSTREAM.md records deliberate exclusions. Preserve them unless the owner has
authorized a different decision; a conflict-free upstream change can still violate
them. In particular retain the recorded React major, World browser tests and downstream service
ownership. Preserve attribution. Use synthetic examples in tracked material.
Retain the existing .github and .codex controls: automated publication refuses
changes to these paths before candidate workflows could run. If integrating an
upstream feature requires changing them, stop and report the required manual work.

Update the exact synchronization point and adopted/excluded behavior in UPSTREAM.md
and the Unreleased changelog. Update dependency notices if the resolved graph
changes, and affected contracts, consumer tests and source navigation when needed.
Assess verification/coverage.json and add meaningful regressions for adaptations.
Do not manufacture a new OpenSpec proposal for ordinary source synchronization.

For an existing PR, fix concrete findings against its frozen target in place.
There is one automated repair pass. Further blockers need operator attention;
never repeatedly retry, create a re-review branch or absorb another release.

The local subscription-backed launcher handles one queued item at a time. Follow
the trusted upstream-local.md prompt for worktree preparation, patch export,
publication and independent review. GitHub creates the PR as github-actions[bot],
then runs full CI. The reviewer is a fresh read-only codex exec process with only
the exact revision, review base and trusted review prompt; never reuse implementer
conversation or substitute the implementer's verdict. An authorized local caller
forwards that JSON verdict; GitHub validates the revision and CI before using a
distinct reviewer App identity. This process trusts the local controller to run
the separate reviewer honestly; GitHub cannot attest model-session independence.

Use cached ChatGPT subscription sign-in locally. Never upload that login cache,
tokens or auth.json to GitHub. The machine must be available when the scheduled
local worker runs. Preserve its worktrees and stop after one item; later work is
driven by GitHub completion events and the next scheduled invocation.

Follow docs/upstream-policy.md. Read .agents/upstream/changes.json and the base
upstream/dispositions.json. Classify every supplied upstream commit (including
release/dependency changes) as adopted, adapted, deferred or divergent, with reason,
evidence and the frozen reviewedFor target. Carry historical records forward.
Revisit every outstanding deferral/divergence, check its trigger and update
reviewedFor; explain the assessment in the integration report. Deferred/divergent
entries need a durable follow-up with owner, acceptance and revisit conditions.
World packaging ownership requires compatible adaptation, not automatic exclusion.
New/changed deferrals or divergences are proposals requiring human approval; do
not claim permanent owner acceptance or silently label omitted behavior adopted.
