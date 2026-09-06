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
.agents/.worktrees directory. Existing dirty checkouts SHALL remain untouched.

#### Scenario: Creation from a linked worktree
- **WHEN** an agent creates another task worktree
- **THEN** it resolves the same central directory without recursive nesting

### Requirement: Bounded execution
Unattended workers SHALL receive no live Herdr socket or host publishing credentials.
The runner SHALL enforce iteration and wall-clock bounds and record explicit outcomes.

#### Scenario: Missing decision or repeated failure
- **WHEN** progress needs an unavailable decision or permission, or the budget is exhausted
- **THEN** the run stops with its reason and recoverable state without claiming completion

### Requirement: Candidate-specific evidence
Readiness SHALL require independent checks, fresh review and behavioral QA for the exact
candidate contents and acceptance revision. QA planning SHALL cover every acceptance criterion
before implementation; QA completion SHALL report an outcome and evidence for every scenario.
A model's completion event SHALL NOT itself prove readiness.

#### Scenario: Changed candidate
- **WHEN** source changes after verification or review
- **THEN** the previous evidence is stale and cannot authorize delivery

### Requirement: Conditional roles and bounded advice
Feature tasks SHALL receive product shaping before delivery. Routine tasks SHALL proceed
without a mandatory product phase or new proposal. Sensitive tasks SHALL receive security
and protocol review. Technical consultations SHALL be read-only, return to the caller and
be limited to two per run, without resetting execution or failure budgets.

#### Scenario: Repeated candidate failure
- **WHEN** two consecutive review, QA or verification failures occur and a consultation remains
- **THEN** the supervisor requests Oracle investigation before another repair

#### Scenario: Acceptance changes
- **WHEN** a delivery role attempts to redefine established acceptance criteria
- **THEN** the adapter rejects it; explicit owner clarification can restart shaping with stale evidence invalidated

### Requirement: Recorded model allocation
The default worker model SHALL be gpt-5.6-luna with xhigh effort. The default lead model
SHALL be gpt-5.6-sol with xhigh effort. Resolved per-role models and effort SHALL be frozen
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
Publishing SHALL be separate from worker execution and SHALL stop at an open PR.

#### Scenario: Review pending
- **WHEN** automated checks pass
- **THEN** the PR remains subject to independent review under AGENTS.md
