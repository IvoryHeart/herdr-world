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
Readiness SHALL require independent checks and fresh review for the exact candidate contents.
A model's completion event SHALL NOT itself prove readiness.

#### Scenario: Changed candidate
- **WHEN** source changes after verification or review
- **THEN** the previous evidence is stale and cannot authorize delivery

### Requirement: Measured agent quality
Harness changes SHALL have deterministic regression checks. Live evals SHALL record exact
task, source, harness, CLI and model inputs, independent grades and explicit unmeasured cost.

#### Scenario: Tampered grader
- **WHEN** a trial agent changes its workspace or claims a passing reward
- **THEN** an independent verifier grades declared artifacts using held-out tests

### Requirement: PR delivery boundary
Publishing SHALL be separate from worker execution and SHALL stop at an open PR.

#### Scenario: Review pending
- **WHEN** automated checks pass
- **THEN** the PR remains subject to independent review under AGENTS.md
