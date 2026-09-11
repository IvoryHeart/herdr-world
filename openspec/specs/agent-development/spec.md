# Agent development

## Purpose

Make authorized development repeatable with maintained knowledge, native coding-agent
execution, independent review and measurable outcomes, without a repository supervisor.

## Requirements

### Requirement: Maintained knowledge
Agents SHALL use AGENTS.md for policy, OpenSpec for current contracts and changes,
and linked docs for source maps and runbooks. Generated wiki pages and private task
notes SHALL NOT override contracts or source evidence.

#### Scenario: Routine fix
- **WHEN** an authorized fix introduces no new contract and the owner requested no spec
- **THEN** it proceeds without a new OpenSpec change or numbered specification

### Requirement: Shared task workspace
New agent worktrees SHALL use non-main branches under the primary checkout's
.agents/worktrees directory. Existing worktrees and unrelated dirty checkouts SHALL
remain untouched. Sequential writers and reviewers SHALL reuse the prepared task
worktree, coordinating ownership to avoid concurrent edits to the same files.

#### Scenario: Creation from a linked worktree
- **WHEN** an agent creates another task worktree
- **THEN** it resolves the primary checkout's central directory without recursive nesting

### Requirement: Native execution and portable skills
The default workflow SHALL use native coding-agent conversations and a repository-selected
subset of pinned, unchanged Superpowers skills with OpenSpec. Local setup SHALL expose
only that selection and preserve it on repeated installation. It SHALL NOT start Ralph,
a second model supervisor or a repository Stop-hook continuation loop. User authorization and repository delivery
policy SHALL continue to apply. Local installation SHALL preserve unrelated settings.

#### Scenario: Full-bundle installation migration
- **WHEN** local setup encounters the verified old full-bundle skill link
- **THEN** it installs only the selected skills without modifying the shared cache or another worktree, and repeated setup does not restore excluded skills

#### Scenario: Conversational task start
- **WHEN** the owner provides a short request and optional parent PR
- **THEN** the lead resolves the actual parent, creates or reuses its task worktree, inspects source and clarifies consequential gaps in the same conversation

#### Scenario: Session started in another checkout
- **WHEN** the lead moves its work into a task worktree
- **THEN** it reads relevant instructions and installed skills explicitly, without treating a fresh discovery check as proof that the current client's configuration or MCP connections reloaded

#### Scenario: Retained task parent
- **WHEN** a native task is recorded with the optional task helper
- **THEN** its explicit parent resolves to a commit, and subsequent records preserve the starting revision while that branch advances

### Requirement: Proportionate delegation and recovery
The lead SHALL select roles for concrete work, reuse native histories for scoped
follow-ups and consume native completion events. Small tasks SHALL NOT require a
mandatory sequence of specialist agents. Independent review SHALL examine the final
relevant changes; an editor SHALL NOT be the sole reviewer of their own edits.

#### Scenario: Review corrections
- **WHEN** a review identifies a concrete defect
- **THEN** the implementer repairs it and a retained independent reviewer examines the changed behavior without repeating unrelated discovery or requiring another role swap

#### Scenario: Repeated lack of progress
- **WHEN** retries or handoffs recur without new evidence
- **THEN** the lead diagnoses the cause, changes the next step or reports the missing decision and recoverable state without claiming completion

### Requirement: Relevant acceptance evidence
The lead SHALL verify the complete implementation with required repository checks and
additional behavioral checks proportionate to the change. Successful evidence MAY be
reused when its relevant source and command inputs remain unchanged. A completion
event or reported agreement SHALL NOT establish product readiness.

#### Scenario: Attribution-only edit
- **WHEN** only a report or changelog PR attribution changes
- **THEN** unrelated successful product suites remain valid and need not run again

#### Scenario: UI integration
- **WHEN** navigation, layout or terminal presentation changes
- **THEN** acceptance covers relevant App integration, empty data, side panels and representative container sizes as well as focused helper behavior

#### Scenario: Slow deterministic check
- **WHEN** a progressing check exceeds an earlier estimate
- **THEN** the lead observes actual duration and allows appropriate completion time rather than inventing a product defect or restarting intake

### Requirement: Recorded model allocation and usage
The task SHALL record selected models and effort and report actual allocations.
Native usage accounting SHALL deduplicate completed response IDs across a lead and
its descendants using native ancestry, distinguish cached input as a subset, and label
missing or unfinished evidence. Cost SHALL remain unknown unless measured.

#### Scenario: Allocation comparison
- **WHEN** actual model or effort differs from a supplied uniform expectation
- **THEN** the usage report identifies the mismatch separately from coverage and incomplete evidence cannot certify a match

#### Scenario: Separate review session
- **WHEN** preparation or independent review ran outside the native lead family
- **THEN** evaluation includes it with an explicit time scope and avoids double counting overlapping child durations

### Requirement: Measured experiments
Harness changes SHALL have deterministic regression checks. Live pilots SHALL record
source, task, tool versions, model allocation, acceptance, interventions, time and usage.
Reference solutions and negative controls SHALL establish grader behavior before scores
are used. A local eval workspace SHALL NOT be described as an isolated security boundary.

#### Scenario: Combined knowledge and skill pilot
- **WHEN** OpenWiki and Skillgrade are tried on the same debugging task
- **THEN** knowledge generation and maintenance are measured separately from debugging and grading, and a combined result does not establish either tool's individual benefit

### Requirement: PR delivery boundary
Delivery SHALL stop at an open ready PR under AGENTS.md. An optional draft SHALL remain
explicitly incomplete until review and relevant checks establish readiness. Merging
SHALL require explicit owner authorization.

#### Scenario: Checks pass
- **WHEN** automated checks pass
- **THEN** independent review and the actual parent branch remain part of delivery evidence
