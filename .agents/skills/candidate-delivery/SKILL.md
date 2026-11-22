---
name: candidate-delivery
description: Deliver a Herdr World branch candidate or review repair through staged formatting, repository hooks, and PR handoff. Use for implementation or documentation handoff, not advice-only work.
---

# Candidate delivery

Work in the required branch worktree. During editing, run focused tests or quick
type checks only when they answer a specific question. Do not run mutating
formatting after each patch.

For Town, Board or Desk PR assets, use `bun scripts/capture-world.ts` against your
own disposable browser's dynamic CDP port, following
[the five-viewport recipe](../../../docs/SCREENSHOTS.md#pr-screenshot-viewports).
The entry takes the shared browser queue. Existing fixture consumers call
`captureResumeViewports` / `captureScene` under their test runner's browser slot.
Supply expected-content selectors for populated fixtures; legitimate empty views
may omit them. Never substitute fixed sleeps or direct screenshot calls. Retain
the helper's revision/dimension/sanity receipts. A deadline or stale revision fails
without saving that image; fix the cause before delivery. This does not freeze
animation or replace visual review, lifecycle checks, independent review or CI.

When the candidate and focused regressions are complete, stage only intended
files. Run `bun run format:staged` once, restage its changes, and inspect the
final diff. The command rejects staged files that also have unstaged edits;
separate those edits first. A docs-only candidate is a safe no-op. Do not format
the whole repository for a scoped change.

Commit with the existing read-only pre-commit format/lint guard when committing
is part of the requested handoff. For PR delivery, push
the complete candidate once and let the pre-push hook run
`bun run check:changed` for code: static checks and affected non-browser units.
Gate or configuration changes run all non-browser units locally; browser and
behavioral acceptance run in CI under required `Delivery checks`.
`HERDR_WORLD_PREPUSH=full` explicitly opts into every local lane. A
Markdown-only follow-up may use
`bun run check:docs` when this worktree has a successful code gate on an ancestor. CI
tests the proposed merge of the PR base and head. Description edits and label
changes may reuse successful full or identically selected scoped results only
for that exact PR, base and head; failed/cancelled results cannot be reused.
Do not run a separate final full check immediately before that push. For an explicitly local-only handoff, run one
explicit `bun run check:delivery` instead. If a later repair changes code, begin a new
candidate cycle.

In Codex, when a command returns a running session, call `write_stdin` on that
session with empty `chars` and `yield_time_ms: 300000`; wait again only if it
actually times out and remains running. Apply the same rule to `gh run watch`.
Do not issue 30-second status loops or separate `ps`/`gh pr checks` probes while
the blocking command is running. Do not add a Codex lifecycle hook for polling;
it cannot intercept `write_stdin`.

Use the [changelog fragment policy](../../../changes/README.md) for format,
timing and exemptions; mention the fragment or the specific no-change reason
in the PR description.
Prepare the PR body in a local file after committing the candidate. Run
`bun run check:pr-body <file>` (append the base ref for a stacked PR), then use
that same file with `gh pr create --body-file <file>` to open one ready PR.
The check shares CI's changelog, source-coverage, spec and verification impact
policies against the committed PR diff. Every non-documentation PR needs two
plain lines without bold labels:

```text
Spec impact: <updated spec path or OpenSpec change name, or none — reason>
Verification impact: <updated model, adapter, coverage owner or named check path, or none — reason>
```

Good examples:

```text
Spec impact: none — Contributor tooling leaves product contracts unchanged.
Verification impact: scripts/check-pr-body.test.ts — Policy input and diff regression cases.
```

Bad examples (each lacks a reason):

```text
Spec impact: none
Verification impact: none
```

Claims must name changed paths (or a spec/change directory or name); an untouched
claim fails. Changes under `openspec/specs/` or `openspec/changes/` forbid
`Spec impact: none`. Changes under `quint/`, `verification/` or an owner in
`verification/coverage/` forbid `Verification impact: none`, including files
under directory owners. This is a cheap consistency check, not a substitute for
review of the assessment and evidence. Before the first push, supply the intended
body through `HERDR_WORLD_PR_BODY=<file>` so the same policy runs locally.
Preserve independent review and CI. For a local-only handoff, finish after the
requested artifacts
and one explicit full check; a PR is not required to count the work as delivered.
Keep later usage and process measurements in workflow output or artifacts
instead of editing the PR body solely for totals.

Fix review findings in place in one correction pass; do not create re-review
branches. Split a PR with too many findings before proceeding. Every commit
changes behavior or docs; keep later verification metadata in the PR/workflow
evidence rather than a metadata-only commit.
