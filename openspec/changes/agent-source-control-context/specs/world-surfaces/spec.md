## ADDED Requirements

### Requirement: Identify the selected agent's current checkout

For an actionable agent Inspector, World SHALL show source-control context for the exact selected connection, runtime generation, pane and active agent session only when that session has reported an admitted checkout through Herdr metadata. World SHALL identify the checkout or linked worktree and obtain its branch and changed-file status from a read-only Git query on the same connection. It SHALL NOT infer an agent checkout from the pane's workspace CWD, terminal CWD, another session or another host. An optional PR URL SHALL be labeled as reported by the harness rather than verified by World.

#### Scenario: Agent uses a different worktree

- **WHEN** an active agent reports a checkout different from its pane's owning workspace and both repositories contain changes
- **THEN** Agent checkout shows the reported worktree's branch and changed files, while Workspace changes remains separately available and labeled

#### Scenario: No trustworthy agent checkout exists

- **WHEN** the agent has not reported a checkout, its report expired, or the reported path is not a reachable Git checkout on its connection
- **THEN** Agent checkout shows an unavailable reason and offers a distinct Workspace changes choice without attributing workspace changes to the agent

#### Scenario: Session or runtime is replaced

- **WHEN** the pane starts another agent session or its connection generation changes while a context request is in flight
- **THEN** the previous checkout, branch, changed files and reported PR cannot appear in the new agent's Inspector

#### Scenario: Two hosts reuse a pane identifier

- **WHEN** two connections contain the same native pane ID and one agent reports a checkout
- **THEN** only the exact connection and generation can show or query that reported checkout

### Requirement: Keep agent checkout inspection read-only and explicit

Agent checkout context SHALL use a bounded read-only Git query and SHALL NOT expose Stage, Unstage, Discard, Delete or other Git mutations for the reported path in this release. Existing workspace Changes SHALL remain a separate scope with its existing authority and confirmation behavior. A browser SHALL NOT supply an arbitrary filesystem path to the agent context query. Report and clear commands SHALL require an explicit pane and active agent session, use bounded source-specific metadata with expiry, and SHALL not start a World web listener.

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
