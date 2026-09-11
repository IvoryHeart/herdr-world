# Agent development

Native Codex owns execution, conversations, subagents and completion. Pinned
[Superpowers 6.3.0](https://github.com/obra/superpowers/tree/v6.3.0) supplies three
selected skills: brainstorming, systematic-debugging and test-driven-development.
OpenSpec holds current contracts and deliberate changes.
AGENTS.md owns authorization, privacy and PR policy; this guide owns procedures.
Other coding clients may use the same skills and contracts, but their discovery,
configuration and accounting need their own validation.

Ralph and its repository-owned supervisor, containers, role protocols and live
adapters are retired. Historical evidence remains in docs/evidence/ and Git.
The [native trial history](superpowers-trial.md) records what was actually tested.

## Start and continue in the same session

A short request and optional parent PR are enough. Inspect the relevant source,
ask only consequential questions, and record acceptance before implementation.
Use Superpowers brainstorming for unresolved product/design choices and systematic
debugging for a failure. Use the existing OpenSpec change as the plan when one
applies; do not duplicate it with another specification or mandatory plan file.

Use those skills for their focused engineering techniques. Their upstream references
to removed planning, review or verification skills do not require installing or
invoking those skills. Continue through this native workflow: clarify consequential
decisions, implement authorized work, test relevant behavior and obtain independent
review before merging. Do not recreate the removed per-task agent/review sequence.
Five OpenSpec skills remain: explore, update, apply, sync and archive. New contracts
can still use the pinned OpenSpec CLI when needed; there is no separate propose skill.

Inspect `git worktree list` and any handoff before creating another worktree. Resolve
the requested parent's actual branch and revision; sibling PRs are not implicitly
included. If no worktree matches the task:

```bash
npm run agent:worktree -- create <slug> <parent-ref>
```

Continue commands in that worktree. Read its AGENTS.md and relevant skills explicitly
if this session started elsewhere. Agents can follow instructions they have read;
changing directory does not automatically reload a client's skill catalog, model or
MCP connections. Install missing skills with:

```bash
node scripts/agent/skills.mjs
npm run eval:skills
```

The installer verifies the full upstream cache and the selected files against pinned
digests, then copies only the three selected skill directories into local discovery.
New downloads use the primary checkout's cache. An existing verified full-bundle
symlink is migrated without changing its cache or another worktree. Repeated setup
preserves the selection; it does not reinstall excluded skills or edit user-wide
skill settings. Modified local skill files are preserved with an error.
It creates local Codex defaults only when absent; it can migrate the byte-identical old trial
profile. Custom configuration is preserved. Only the exact obsolete trial instruction
override is removed; reconcile a custom override deliberately. No user-wide install
or configuration is changed. Explicit skill reads allow current work to continue;
only a client capability that actually needs reload justifies a session handoff.

`eval:skills` queries a fresh Codex App Server without a model turn. It verifies
the three selected Superpowers skills, five OpenSpec skills, two repository skills and excluded-skill absence,
and reports effective configuration; `activeSessionVerified: false`
is intentional. It does not certify the lead's model or successful skill use.

Keep a short task record in ignored `.agents/state/`: parent revision, accepted
requirements, decisions, source paths, checks, native thread IDs and next action.
The optional helper preserves the actual parent commit:

```bash
npm run agent:task -- native --parent <parent-ref> --reason owner-request --note "Authorized task"
```
 A task record
is a recovery aid, not a prerequisite for ordinary authorized work or PR publishing.
Native Goals are used only when the owner explicitly requests a goal.

## Work allocation and review

The lead handles planning, clarification, integration and progress decisions.
Delegate a bounded implementation or a substantive independent review when it
benefits the task. Small changes do not need a mandatory implementer, product
manager, oracle and QA agent. Product shaping and adversarial analysis are skills
or review lenses until a distinct investigation justifies a separate agent.

Keep one prepared worktree for the task. Coordinate file ownership if independent
work overlaps; never schedule concurrent writers to the same files. Reviewers
normally read and report. If a reviewer makes a correction, another history must
review those edits. A clean independent review does not require another role swap.
Resume the implementer or reviewer for scoped follow-ups with the changed facts,
diff and outstanding findings. Do not repeatedly send full reports or rediscover
source that has not changed. Upstream examples do not require a fresh reviewer
for every correction or a second whole-branch review of an unchanged candidate.

| Responsibility | Owner-selected default | When used |
| --- | --- | --- |
| Lead and planning | Sol, xhigh | Current conversation; report actual model if different |
| Implementation and coding | Luna, xhigh | Bounded implementation or repair |
| Product research and adversarial review | Terra, xhigh | A concrete research question or independent review |
| Oracle | Explicitly selected available model | A consequential technical uncertainty |

The owner's earlier name “atlas” has no confirmed mapping to an available Oracle
model. Do not silently alias it. An Oracle consultation is optional and requires
an explicit available model selection when needed. Task complexity can justify a
proposed override for one role; record the reason and actual allocation. Do not
escalate every role because one subproblem is difficult. These defaults are
preferences, not a validated adaptive routing algorithm. PR84 tested Sol/high,
not this mixed allocation. Respect the active client's actual tool schema.

Use native completion notifications. If no useful local work remains, wait through
the client's lifecycle tool within its responsiveness limits. For CI, keep one
`gh pr checks <number> --watch --interval 30` process and consume its result.
Avoid a model response for each unchanged poll. Communicate meaningful progress
and blockers as required by the client; a separate periodic observer is unnecessary.

When work repeats without new evidence, the lead identifies whether the cause is
requirements, implementation, review, testing or infrastructure, changes the next
step, and reports the issue. Resume useful work after a transient failure. Stop
and explain when permission or a consequential decision is missing, an explicit
budget is exhausted, or repeated attempts produce no defensible next step. Do not
restart intake or create another supervisor to recover from an ordinary failed check.

## Dependencies, checks and delivery

Reuse the worktree's prepared dependencies. Run `npm ci` only for missing or
intentionally refreshed root, web or harness dependency trees. Share package-manager
download caches. A verified local copy/reflink of matching manifests and lockfiles
can avoid an install. Do not install through a node_modules symlink or mutate another
task's dependency tree. A compatible Cargo target may be reused through
`CARGO_TARGET_DIR`; coordinate concurrent builds. Do not copy build outputs per reviewer.

Use focused tests while editing. The lead owns complete `npm run check` on the final
implementation and additional browser/security/protocol checks appropriate to the
change. Reuse evidence when its relevant source and command inputs remain unchanged;
a report or changelog attribution alone does not invalidate unrelated product checks.
A changed product path needs the relevant regression rechecked, including its callers.

For UI work, test real App navigation and selection, empty data, side panels and
representative container widths as well as viewport sizes. Inspect rendered results.
A small happy-path fixture cannot establish readability or behavior at every scale.

Observe command duration. A slow but progressing check is not a code defect, and a
suite must have enough time to finish on the actual machine. Diagnose an infrastructure
failure before changing code or test expectations. Native process cancellation and
any explicit task budget still apply; this repo adds no phase or fingerprint timeout.

Independent review and relevant checks establish delivery readiness. Resolve concrete
findings and preserve remaining limitations. Use ordinary Git/GitHub tools to open a
ready PR against the actual parent. Stop there under AGENTS.md; do not merge unless
explicitly instructed. Never claim a native completion event proves acceptance.

## Evaluation and economy

Run `test:agent`, `spec:check` and `eval:check` for harness changes. They establish
mechanics, contract validity and grader controls, not model quality. See
[evals/README.md](../evals/README.md) and the [combined terminal pilot](agent-pilots.md).
Skillgrade and OpenWiki are opt-in experiments with separate installation dependencies.
They are not normal CI requirements or replacements for independent product review.

After a native turn finishes, collect the lead and descendants without another model:

```bash
npm run agent:usage -- --thread LEAD_THREAD_ID --since START_ISO --until END_ISO --output .agents/state/native-usage.json
```

For a uniform comparison add `--expect-model` and `--expect-effort`; for mixed work
inspect reported per-role models against the task's recorded allocation. Native parent
metadata determines inclusion. Add separately launched preparation and external-review
sessions with explicit scopes; shared working directory is not ancestry. Deduplicate
response IDs. Cached input is part of input; reasoning is part of output. Cost remains
unknown unless independently measured. An in-session report excludes its later final
response and is provisional. Missing/unfinished evidence must remain visible.

Measure accepted behavior, first-pass defects, total active task intervals, human
waiting, command time, repeated reviews/checks, interventions and storage alongside
usage. Internal children overlap the lead, so do not sum their wall times. OTEL is
corroboration; investigate export gaps rather than substituting lower counters. Raw
sessions and local identifiers stay private. Change one experimental input at a time
where possible and label combined pilots and unmatched historical comparisons honestly.
