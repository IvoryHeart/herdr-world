## ADDED Requirements

### Requirement: Identify the selected agent's current checkout

For an actionable agent Inspector, World SHALL show source-control context for the exact selected connection, runtime generation, pane and active agent session only when a complete reported checkout has a fingerprint matching that current Herdr session. World SHALL identify the checkout or linked worktree and obtain its branch and changed-file status from a read-only Git query on the same connection. It SHALL NOT infer an agent checkout from the pane's workspace CWD, terminal CWD, another session or another host. An optional PR URL SHALL be labeled as reported by the harness rather than verified by World.

#### Scenario: Agent uses a different worktree

- **WHEN** an active agent reports a checkout different from its pane's owning workspace and both repositories contain changes
- **THEN** Agent checkout shows the reported worktree's branch and changed files, while Workspace changes remains separately available and labeled

#### Scenario: No trustworthy agent checkout exists

- **WHEN** the agent has not reported a checkout, Herdr lost the report on restart, the token set is malformed, or the reported path is not a reachable Git checkout on its connection
- **THEN** Agent checkout shows an unavailable reason and offers a distinct Workspace changes choice without attributing workspace changes to the agent

#### Scenario: Session or runtime is replaced

- **WHEN** the pane starts another agent session or its connection generation changes while a context request is in flight
- **THEN** the previous checkout, branch, changed files and reported PR cannot appear in the new agent's Inspector

#### Scenario: Two hosts reuse a pane identifier

- **WHEN** two connections contain the same native pane ID and one agent reports a checkout
- **THEN** only the exact connection and generation can show or query that reported checkout

### Requirement: Keep agent checkout inspection read-only and explicit

Agent checkout context SHALL use a bounded read-only Git query and SHALL NOT expose Stage, Unstage, Discard, Delete or other Git mutations for the reported path in this release. Existing workspace Changes SHALL remain a separate scope with its existing authority and confirmation behavior. A browser SHALL NOT supply an arbitrary filesystem path to the agent context query. A report command SHALL require an explicit pane and active agent session and SHALL NOT offer post-session Clear: the token keys are pane-global and a delayed Clear could erase a newer session's report. The report command SHALL not start a World web listener. The report SHALL use a versioned, bounded token set with a digest of the exact current agent-session identity; it SHALL omit Herdr TTL, require no periodic renewal while that session remains current, and become unavailable after session replacement, pane closure or Herdr server restart.

#### Scenario: Inspect an agent's changed files

- **WHEN** a valid current-session checkout report names a Git worktree with modified files
- **THEN** the Agent checkout view lists bounded file statuses and a branch for that worktree without offering a Git mutation

#### Scenario: Explicitly inspect workspace changes

- **WHEN** a user chooses Workspace changes from an agent Inspector
- **THEN** the existing workspace checkout and its normal Changes resource appear with a clear Workspace label, without changing the agent checkout report

#### Scenario: Reported PR is present

- **WHEN** a harness reports a valid HTTPS PR URL with the current agent checkout
- **THEN** the Inspector labels it Reported PR and does not imply World verified its relationship to the repository

#### Scenario: Browser supplies a path

- **WHEN** a client attempts to choose a checkout path in the agent context request
- **THEN** the service rejects or ignores that path and resolves only the current Herdr metadata for the qualified agent session

#### Scenario: Long-running current session

- **WHEN** an agent reports its checkout once and the same Herdr agent session remains active for longer than 24 hours
- **THEN** Agent checkout remains available without a refresh hook, subject to the checkout still being reachable and a current qualified observation

#### Scenario: A shorter report replaces a longer one

- **WHEN** a current session replaces a long checkout path and PR URL with a shorter path and no PR
- **THEN** the report atomically clears unused path and PR chunks so no old suffix or link appears

#### Scenario: Delayed cleanup after another session reports

- **WHEN** session B has reported its checkout after session A and a delayed A hook invokes `herdr-world agent-checkout --clear` for that pane
- **THEN** Clear is rejected before any Herdr metadata request, B's complete token set and Agent checkout remain intact, and Workspace changes remains unchanged

### Requirement: Bound and atomically replace checkout reports

The `agent-checkout` report SHALL accept an absolute UTF-8 checkout path of at most 540 bytes and an optional HTTPS PR URL of at most 240 UTF-8 bytes. It SHALL encode these and the exact session fingerprint in a versioned set of at most 15 Herdr pane tokens, each no longer than Herdr's 80-character token limit, and replace the complete set in one metadata call, clearing only unused chunks within that same replacement report. It SHALL reject an explicit TTL option because the report's lifetime is the current agent session. A failed capacity or validation check SHALL not leave a partial new checkout report.

#### Scenario: Report exceeds the metadata bounds

- **WHEN** a path or PR URL exceeds its bound or Herdr cannot retain the full token set
- **THEN** the report fails with a bounded explanation and Agent checkout does not show a partially updated path or link

#### Scenario: A timer option is supplied

- **WHEN** a harness supplies `--ttl-ms` to `herdr-world agent-checkout`
- **THEN** the command rejects the option before writing metadata and explains that the report is held for the exact current agent session
