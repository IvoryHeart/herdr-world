# Agent development

The development harness combines OpenSpec, focused repository skills, Ralph Orchestrator
and Harbor evals. It supports ordinary interactive work and explicitly started bounded
runs. Product architecture changes remain a separate concern.

## Start a task

From any checkout:

```bash
npm run agent:worktree -- create fix-reconnect
# Enter the path printed by the command.
npm run agent:bootstrap
npm run agent:doctor
```

Worktrees share the primary checkout's ignored `.agents/.worktrees/`. Creation fetches
`origin/main`; pass an explicit ref as the last argument to use an existing commit without
fetching. Each task gets `agent/<slug>`, never main. Existing worktrees are left alone.
`agent:worktree -- list` and `doctor` show placement. Remove finished worktrees with
Git's normal worktree command after preserving any uncommitted work; there is no automatic cleanup.

Read AGENTS.md and the relevant [knowledge-map](knowledge-map.md) entries. Repository
skills are discoverable under `.agents/skills/`. Use the skill matching the task rather
than loading every skill. Agents without native skill discovery can read those same files.

## Knowledge and OpenSpec

| Information | Owner |
| --- | --- |
| Mandatory repository and delivery rules | AGENTS.md |
| Current observable capability contracts | openspec/specs |
| Proposed coherent changes | openspec/changes |
| Source ownership, operation and troubleshooting | docs/knowledge-map.md and linked runbooks |
| Historical decisions and research | docs/specs and docs/analysis |
| In-flight progress and recovery notes | ignored .ralph/agent inside a run |
| Grading evidence and generated graphs | ignored eval/run output; never authoritative |

Use a proposal for an owner-requested spec or a genuinely new contract. Routine fixes,
refactors, dependencies, tests, docs and release mechanics need no new change proposal.
A small fix may still update an affected current spec. Existing authorization carries
through planning, implementation, verification and authorized PR delivery.

```bash
npm run spec -- new change improve-terminal-recovery
npm run spec -- status --change improve-terminal-recovery --json
npm run spec -- instructions proposal --change improve-terminal-recovery --json
npm run spec -- instructions apply --change improve-terminal-recovery --json
npm run spec:check
```

Follow the CLI's schema, dependency order and returned artifact paths. Keep one change
per outcome. Synchronize implemented deltas into current specs before archiving.
A task checkbox is progress, not proof. Do not archive unfinished work. The standard
`spec-driven` schema is sufficient; project context and rules are advisory and checks
remain executable.

The six OpenSpec skills are concise repository adaptations of version 1.12.0.
Upstream's mandatory planning pause does not replace the user's existing authorization.
Review generated skill updates before adopting them; do not run an installer that silently
overwrites repository policy.

## Roles and skills

| Role | Work | Boundary |
| --- | --- | --- |
| Product manager | world-shape-work; user outcome, scope, non-goals and acceptance | Feature intake only; read-only; no invented research or roadmap authority |
| Planner | world-plan-change; inspect source, plan and select specialist lenses | Read-only; preserves existing acceptance exactly |
| QA planner | world-test-behavior; derive scenarios before implementation | Read-only; covers every acceptance criterion independently |
| Implementer | Implement; world-verify-change and conditional world-maintain-knowledge | One worker, one candidate; no publishing authority |
| Reviewer | world-review-change plus selected world-review-specialist lenses | Fresh context; candidate mounted read-only in local runs |
| Behavioral QA | world-test-behavior; exercise every planned scenario | Read-only source; evidence per scenario; no repairs |
| Oracle / technical adviser | world-consult-oracle; investigate a concrete technical question | Read-only; at most two consultations across the run and resumes |
| Verifier | Deterministic commands | No model call; separate candidate copy and no model credential |
| Supervisor | Ralph plus the repository adapter | Limits, events, recovery and content-specific completion |
| Publisher | world-deliver-pr outside the loop | Push task branch and open PR; never merge |

Role instructions live in harness/roles; skills supply reusable procedures. Executable
permissions, schemas and routing live in scripts/agent, not just prompts. Every model
activation starts fresh. The loop's internal review does not replace independent PR review.

Choose a task profile separately from the verification profile:

| Task profile | Routing |
| --- | --- |
| routine (default) | Planner → QA planner → implementer → reviewer → QA → verifier |
| feature | Product manager → routine delivery stages; product shaping happens once per outcome |
| sensitive | Routine stages with mandatory security and protocol review lenses |

The planner can activate security, protocol, ux-accessibility or performance review for a
concrete risk in any profile. These lenses extend the reviewer activation; they do not
create an always-on committee. Browser/runtime changes still need the acceptance verification
profile. Routine fixes never acquire a mandatory OpenSpec proposal just by entering a loop.

Product/planner acceptance criteria become supervisor-owned state. QA scenarios are derived
before implementation and must cover every criterion. The QA result must include all scenario
IDs, outcomes and execution/source evidence. Passing requires every scenario to pass.
Read-only QA can use /tmp for generated output or a temporary test copy; it cannot repair the
candidate. LLM-reported QA evidence is still fallible; the deterministic verifier and held-out
eval grader provide additional independent checks.

Planner, QA planner, implementer, reviewer and QA can request an Oracle consultation with a
specific question. Two consecutive candidate failures automatically trigger a consultation
before another repair. Advice returns to the requesting role and cannot change acceptance,
reset the failure budget or override checks. An owner clarification on resume can revise scope;
the runner invalidates the old acceptance and QA plan and starts shaping/planning again.

Knowledge maintenance normally happens within implementation. A targeted drift audit can
use world-maintain-knowledge separately. The eval/harness engineer uses world-evaluate-harness
between runs to turn failures into cases and propose improvements through PRs. In-flight
workers cannot change their control copy or grader. Coordinating multiple worktrees uses
world-integrate-work interactively; autonomous parallel scheduling remains disabled until
there is an authorized concurrent workload and evidence to justify it.

## Models

The committed policy in harness/models.json assigns **gpt-5.6-luna at xhigh** to implementation
and QA execution. Product management, technical planning, QA design, review and Oracle advice
use **gpt-5.6-sol at xhigh**. Supervisor and verifier do not call a model.

This is an initial allocation to evaluate, not a measured claim that these are optimal models.
Use --worker-model or --lead-model to override a tier; --model overrides every model role for
controlled comparisons. --reasoning-effort overrides effort for every role. Resolved model
IDs and effort are frozen in run state, recorded per turn, and preserved on resume. There is
no silent model fallback. Compare accepted outcomes, defects, false positives, repair cycles,
interventions, duration and reported tokens before changing defaults.

## Verification

```bash
npm run agent:verify -- check
npm run agent:verify -- acceptance
npm run agent:verify -- harness
```

| Change | During implementation | Delivery evidence |
| --- | --- | --- |
| Ordinary source changes | Relevant Vitest/Rust/Node tests | check |
| Browser behavior or runtime integration | Relevant fixture browser scenarios | acceptance |
| Harness, rules, roles or skills | test:agent, spec:check, eval:check; relevant Harbor trials | check plus harness/eval evidence |
| Release, packaging or vendor changes | Corresponding runbook checks | check plus required distribution evidence |

A receipt in `.agents/state/verification.json` includes the source fingerprint,
commands, exit codes, duration and logs. The fingerprint covers tracked and non-ignored
new source, executable bits and symlinks; generated state is excluded by Git ignores.
Any source edit invalidates the receipt. A content-identical commit does not.
Run `npm run check` before committing. Failed or unrun checks are reported as such.

CI runs deterministic harness checks and spec validation on PRs without model credentials.
The `Delivery checks` job requires all normal CI, browser, macOS and harness jobs.
The GitHub rules helper prepares or checks the corresponding main-branch policy.

## Bounded unattended runs

Build the image once and start from a clean, committed task branch:

```bash
npm run agent:image
npm run agent:run -- start --task-file /tmp/world-task.md --task-profile feature --profile acceptance
# Optional uniform model override for a controlled comparison:
npm run agent:run -- start --task-file /tmp/world-task.md --model gpt-5.6-luna
npm run agent:run -- status RUN_ID
npm run agent:run -- resume RUN_ID
npm run agent:run -- resume RUN_ID --task-file /tmp/world-clarification.md
```

The task file must describe an authorized outcome and its known constraints. The selected
models must be available to your account. Codex is the initial backend. The adapter
uses its pinned CLI and saved authentication; `--auth-file` selects an explicit auth file.
Credentials are never copied into the repository or result bundle.

A run copies the candidate into a private repository without remotes or shared Git metadata,
under the primary checkout's ignored `.agents/runs/<id>/workspace`. It freezes a separate
control copy of the harness. Ralph owns routing and fresh activations. Repository code
adds container execution, structured role events, verification and the final content gate.

Default bounds are 24 activations/iterations, one hour and three consecutive failures.
Each model invocation has a 15-minute ceiling. Use `--iterations` and `--seconds` to set
an explicit task budget. Wall-clock bounds cover loop execution, including verification.
Ralph's custom-backend inactivity timeout is explicitly 16 minutes, so a buffered model
call is governed by the adapter's 15-minute deadline rather than an inherited five-minute
default. The pinned Ralph version reads that custom timeout from its `claude` adapter slot;
the worker still runs the selected Codex model.
Initial dependency setup has its own 20-minute timeout. Limits persist across resume.
Resume retains candidate and role notes while archiving the
previous Ralph event ledger, so old completion events cannot bypass fresh review.
An optional clarification file adds the owner's missing decision without resetting those limits.
An exhausted run requires a new authorized run; resume does not reset its failure budget.
SIGINT/SIGTERM preserves progress and cleans up invocation-owned containers. A hard-killed
supervisor may leave a lock; verify its recorded PID is dead before removing that run's lock.

Outcomes are `ready-for-review`, `blocked`, `failed`, `interrupted` and `exhausted`.
Ready requires acceptance coverage, fresh review, passing behavioral QA and independent
checks for identical source content and the same acceptance revision.
The completion event cannot supply that evidence. Changes to harness controls or package
manifests stop for interactive development and review; the verification entry points remain fixed
for the run. Use interactive work plus evals for harness improvements.

Worker containers have no host home directory, Herdr socket, SSH agent, Docker socket,
Git remotes, publishing credentials or published ports. The selected model auth file, private Git metadata and Ralph event/progress directory
are mounted read-only for model calls. The supervisor writes role notes after each call.
All model roles except the implementer mount the candidate read-only; verification
runs on a fresh copy without model auth. Acceptance dependency audits have network access
to advisory services; source, browser and independence checks run with networking disabled.
Fixed browser fixture ports are private to each container.

Model containers and dependency setup currently have network egress. This is a local
trusted-task harness, not an adversarial network sandbox: do not feed it untrusted jobs or
grant production authority. Model authentication is usable inside its worker container.
Use a dedicated runner account and scoped model credentials for unattended hosting.
Ralph 2.10.1 inherits global hooks, so the wrapper refuses a runner account with
`~/.ralph/config.yml`. No personal MCP or Codex config is loaded.

Cost is recorded as `null` when the CLI does not report it. A time or iteration limit is
not a dollar cap. Use provider-side spending limits for metered operation. Logs are private,
ignored artifacts and may contain task data; review before sharing them.

## Deliver the candidate

The loop exports `candidate.patch` and evidence; it never edits the original task checkout
or publishes a PR. Inspect the patch and apply it to the task branch:

```bash
git apply --index /path/to/run/candidate.patch
npm run agent:verify -- acceptance
git commit -m "Fix terminal recovery"
npm run agent:deliver -- --title "Fix terminal recovery" --body-file /tmp/world-pr.md
```

Choose the relevant profile. The publishing helper rejects main, dirty worktrees, and
missing, insufficient or stale receipts. It pushes only the current branch and opens a PR.
Add the PR reference to applicable changelog entries, revalidate and push that branch update.
Stop at the PR. Independent review remains required.

Receipts are local operational evidence, not cryptographic attestations against their owner.
CI and GitHub branch rules provide the independent delivery boundary.

## Evals and optional tools

See [evals/README.md](../evals/README.md) for oracle controls, baseline versus Ralph trials,
version capture and result reporting. Do not infer model readiness from passing stand-ins
or oracle tests. Start with a small authorized task set, inspect failures, then widen task
scope based on measured reliability.

The [live trial report](evidence/agent-development-live-trials.md) records authenticated
model outcomes, control failures found and fixed, and the limits of the initial sample.

Graphify remains optional. The [existing audit](analysis/agentic-development-capabilities-2026-09-01.md)
found useful local relationships but missed a real TypeScript → HTTP → Rust path.
If piloting it, use the audited pinned code-only mode in an isolated archive, store output
outside tracked source, and compare navigation eval results before making it a default.
Do not install its automatic AGENTS or hook modifications. No graph database, permanent
agent swarm, or additional orchestration framework is needed for this foundation.
