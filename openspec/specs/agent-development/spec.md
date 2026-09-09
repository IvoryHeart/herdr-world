# Agent development

## Purpose

Make authorized development repeatable with maintained knowledge, isolated execution,
bounded loops, independent verification and measurable outcomes.

## Requirements

### Requirement: Maintained knowledge
Agents SHALL use AGENTS.md for policy, OpenSpec for current contracts and changes,
and linked docs for source maps and runbooks. Runtime notes SHALL NOT override them.

#### Scenario: Routine fix
- **WHEN** an authorized fix introduces no new contract and the owner requested no spec
- **THEN** it can proceed without a new OpenSpec change or numbered specification

### Requirement: Shared worktree location
New agent worktrees SHALL use non-main branches under the primary checkout's
.agents/worktrees directory. Existing .agents/.worktrees locations SHALL remain
valid, and existing dirty checkouts SHALL remain untouched.

#### Scenario: Creation from a linked worktree
- **WHEN** an agent creates another task worktree
- **THEN** it resolves the same central directory without recursive nesting

### Requirement: Explicit upstream workflow trial
An owner-selected Superpowers trial SHALL use pinned, unmodified upstream skills
installed locally to a fresh task worktree. OpenSpec SHALL remain the repository's
requirements and knowledge authority. The trial SHALL use native coding-agent
execution, with no nested Ralph launcher or second continuation mechanism.
Repository policy and the selected task's authorization SHALL remain applicable.
The Ralph-specific execution requirements below SHALL apply to Ralph runs, not to
an explicitly selected native trial.

#### Scenario: Trial isolation
- **WHEN** an owner selects the native trial
- **THEN** its local profile changes no user-wide skills or settings, and an existing Ralph task is not converted or restarted

#### Scenario: Trial delivery
- **WHEN** native execution reaches an implementation candidate
- **THEN** review and relevant checks establish readiness, the PR identifies the actual workflow, and no Ralph success or cost improvement is inferred

#### Scenario: Native usage attribution
- **WHEN** a native lead thread is evaluated
- **THEN** completed response IDs are deduplicated across that lead and descendants identified by native parent metadata, actual model allocations are reported, and unfinished or missing evidence is labelled provisional

#### Scenario: Allocation differs from the selected trial
- **WHEN** recorded model or effort differs from an explicitly supplied expectation
- **THEN** the usage report identifies the mismatch separately from token coverage; incomplete evidence cannot certify an allocation match, and discovery alone does not certify the running session

#### Scenario: Native task parent
- **WHEN** a native task is first recorded
- **THEN** its explicit parent reference resolves to a commit, and subsequent recording preserves that starting revision while the parent branch advances

#### Scenario: Scoped verification
- **WHEN** a worker or reviewer changes a candidate
- **THEN** it exercises relevant behavior and the lead owns complete final acceptance; unchanged evidence is reused, and representative visual workloads prevent a small fixture from establishing universal readability

### Requirement: Bounded execution
Unattended workers SHALL receive no live Herdr socket or host publishing credentials.
The runner SHALL enforce activation and cumulative model-time bounds, separate deterministic
command safety deadlines, and explicit outcomes. Waiting for the owner and managed checks
SHALL NOT consume the pair model-time allowance.

#### Scenario: Missing decision or repeated failure
- **WHEN** progress needs an unavailable decision or permission, or the budget is exhausted
- **THEN** the run stops with its reason and recoverable state without claiming completion

### Requirement: Candidate-specific evidence
Readiness SHALL require independent checks, fresh review and behavioral QA for the exact
candidate contents and acceptance revision. The pair SHALL report behavioral evidence for
every acceptance criterion. The other partner SHALL accept the latest proposal, and a lead
independent of both partner histories SHALL accept the verified result. A partner MAY review
the other partner's later edits even if it previously implemented part of the task.
A model's completion event SHALL NOT itself prove readiness.

#### Scenario: Changed candidate
- **WHEN** source changes after verification or review
- **THEN** the previous evidence is stale and cannot authorize delivery

### Requirement: Conditional roles and bounded advice
Feature tasks SHALL receive product shaping before delivery. Routine tasks SHALL proceed
without a mandatory product phase or new proposal. Sensitive tasks SHALL receive security
and protocol review. Technical consultations SHALL be read-only, return to the caller and
be limited to two per run, without resetting execution or failure budgets.

#### Scenario: Repeated unresolved handoffs
- **WHEN** the pair repeatedly returns the same unresolved finding or fails to converge
- **THEN** the supervisor requests lead guidance and pauses if that guidance fails to resolve recurrence; optional Oracle advice does not reset authorization

#### Scenario: Acceptance changes
- **WHEN** a delivery role attempts to redefine established acceptance criteria
- **THEN** the adapter rejects it; explicit owner clarification can restart shaping with stale evidence invalidated

### Requirement: Recorded model allocation
The default lead and both persistent partners SHALL use gpt-5.6-sol with high effort; Oracle
SHALL use gpt-5.6-sol with xhigh effort. The optional full workflow SHALL use gpt-5.6-luna
with xhigh effort for bounded implementation and QA. Resolved models and effort SHALL be frozen
for a run and recorded per turn. Explicit uniform and tier overrides SHALL be supported.

#### Scenario: Resume
- **WHEN** an interrupted run resumes
- **THEN** its original model allocation, consultation count and remaining budgets persist

### Requirement: Measured agent quality
Harness changes SHALL have deterministic regression checks. Live evals SHALL record exact
task, source, harness, CLI and model inputs, independent grades and explicit unmeasured cost.

#### Scenario: Tampered grader
- **WHEN** a trial agent changes its workspace or claims a passing reward
- **THEN** an independent verifier grades declared artifacts using held-out tests

#### Scenario: Improving the harness
- **WHEN** a recurring failure motivates a role, skill, model or grader change
- **THEN** the change is evaluated outside the active worker run and delivered through the repository's reviewed PR workflow

### Requirement: PR delivery boundary
Publishing SHALL be separate from worker execution and SHALL stop at an open ready PR.
An optional draft MAY expose an explicitly incomplete coherent checkpoint. Marking it ready
SHALL require the same final evidence as ordinary delivery.

#### Scenario: Review pending
- **WHEN** automated checks pass
- **THEN** the PR remains subject to independent review under AGENTS.md

### Requirement: Goal intake and retained role histories
A short goal SHALL create a fresh task worktree and start source-grounded intake.
The coordinating agent SHALL launch the recorded entrypoint before feature research,
interview, planning or edits, and report its worktree, job and run identifiers. Reading
workflow documentation or using OpenSpec/check commands alone SHALL NOT count as execution.
Missing consequential owner decisions SHALL produce saved questions and a stopped run.
Answers SHALL resume the lead history without charging human waiting time or resetting budgets.
An open same-repository parent PR MAY select the task and delivery base.

#### Scenario: Conversational feature start
- **WHEN** the owner provides a short feature goal and an optional parent PR
- **THEN** managed intake begins in a recorded run without requiring a larger prompt, and a supervisor-assigned worker does not recursively launch another run

#### Scenario: Delivery bypass
- **WHEN** a feature has passing tests but no successful recorded harness run or independent review/QA history
- **THEN** checked delivery rejects it before pushing or creating a PR and does not silently fall back to interactive implementation

#### Scenario: Declared interactive exception
- **WHEN** the authorized task changes harness controls or the owner explicitly requests interactive development
- **THEN** a separate task records that exception and delivery identifies interactive execution without claiming Ralph success

#### Scenario: Visual reference
- **WHEN** the owner supplies a supported reference image with the goal or an interview answer
- **THEN** model phases receive a private read-only copy, and the image is not added to candidate source merely to transport it

#### Scenario: Interview continuation
- **WHEN** the owner supplies answers to a saved interview
- **THEN** the lead resumes its native session, establishes acceptance and continues to planning without duplicate product shaping

### Requirement: Durable state outside disposable containers
The default workflow SHALL retain a lead history for intake, guidance and acceptance, and
two separate partner histories across sequential implementation/review turns. Partners and
checks SHALL share one prepared task worktree under a single supervisor writer lock. A
clean independent review SHALL NOT require another role swap or polishing lap. Oracle SHALL
retain a separate history when consulted. A full workflow MAY isolate a bounded builder.
Native state SHALL live in ignored run storage and only the active group's home SHALL
be writable in its container. Supervisor metadata and shared handovers SHALL be outside
that writable mount. A fresh-session comparison mode SHALL remain available.

#### Scenario: Interrupted native turn
- **WHEN** a model reports its thread ID and the invocation is interrupted
- **THEN** the next activation can resume that exact saved ID in a recreated container

#### Scenario: Repair introduces a new defect
- **WHEN** the candidate changes after review
- **THEN** the same independent review history receives the candidate delta and changed decisions, checks affected behavior for new defects, and produces new evidence for the changed candidate

### Requirement: Separate command deadlines and recoverable progress
Pair model turns SHALL share a cumulative model-time allowance without fixed phase shares.
Managed commands SHALL have independent safety deadlines and expected-duration observations.
The supervisor SHALL retain checkpoints and stop descendants before recording interruption.
Successful command results MAY be reused only for the same source, image and command.

#### Scenario: Slow browser suite
- **WHEN** a suite takes longer than the old verification phase allocation but remains within its command deadline
- **THEN** the suite continues without consuming model-time allowance or launching a repair agent merely for its duration

#### Scenario: Infrastructure failure
- **WHEN** a recognized transient infrastructure failure occurs
- **THEN** at most one automatic command retry occurs without a model, and persistent failure or a safety deadline saves a resumable step instead of inventing a code defect

### Requirement: Explicit control upgrade
Ordinary resume SHALL use frozen controls, retained histories and remaining authorization.
Recovery to updated controls SHALL preserve old evidence, the task worktree and accepted
requirements, retain native histories where available, and record lineage. Additional model
time or activations SHALL require explicit allocation; stale approvals SHALL NOT carry over.

#### Scenario: Legacy candidate recovery
- **WHEN** an interrupted copied-workspace run upgrades to the pair workflow
- **THEN** its pending patch is checked before import, author/review histories map to separate partners, and work resumes from the retained candidate rather than repeating intake

#### Scenario: Disk pressure
- **WHEN** available bytes or inodes approach the configured reserve
- **THEN** lifecycle health checks warn, suspend at the critical reserve and preserve source and old evidence without deleting another task's worktree

### Requirement: Durable usage accounting
The supervisor SHALL record attempt lifecycle and incremental native response usage outside
worker-writable storage. Accounting SHALL deduplicate response IDs, include compaction and
recover interrupted attempts, while labelling missing or potentially incomplete usage.
An optional explicit OTEL exporter SHALL send only usage and lifecycle fields, without
copying user configuration or exporting prompts/tool output for accounting.

#### Scenario: Killed response stream
- **WHEN** a worker is killed before turn completion
- **THEN** its previously reported response usage remains attributable to run, role, attempt and model and is not replaced by zero usage

#### Scenario: Export reconciliation
- **WHEN** native ledger records are compared with stored OTEL usage
- **THEN** missing responses and mismatched token fields are reported independently of collector acknowledgments

### Requirement: Supervision without a monitoring model
Background jobs SHALL run under deterministic process supervision and expose saved state
and completion/question/failure outcomes without requiring an outer model to poll.
The supervisor SHALL persist a factual recap every five minutes and at job exit without
invoking a model observer. Recaps SHALL distinguish observations from acceptance and
include timestamp, active work, last completed handoff, unresolved findings and recorded
usage coverage. Host notification support SHALL be reported separately from local recap
production. Resumed model turns SHALL receive the relevant handoff facts without loading
all prior reports. Active runs SHALL NOT be restarted just to install recap support.

#### Scenario: Waiting for delivery
- **WHEN** a background worker is executing an authorized task
- **THEN** it continues without model polling; a host lacking automatic wake-up reports the running job and returns rather than claiming an unimplemented callback
