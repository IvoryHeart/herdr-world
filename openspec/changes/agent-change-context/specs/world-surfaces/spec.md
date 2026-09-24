## MODIFIED Requirements

### Requirement: Native World shell

The Roamgate-derived workspace, terminal, connection and Inspector experience SHALL ship as native
Herdr World functionality alongside Spaces, Office, Tree and Graph. Those views SHALL share the
same connection identities, admitted topology, Inspector resources and terminal ownership; World
SHALL not embed or launch a separately branded Roamgate application.

#### Scenario: Install World only

- **WHEN** a user installs and starts Herdr World
- **THEN** local and SSH connection management, terminal workspaces, Files, Changes, Agent History
  and native World visual views are available without installing Roamgate or another web bridge

#### Scenario: Use the Inspector without leaving a visual view

- **WHEN** a user selects an actionable space or pane on the selected operational host in Office,
  Tree or Graph and opens Files, Changes or Agent History
- **THEN** the selected visual view remains visible and the shell-owned Inspector uses only that
  entity's owning connection, runtime generation, workspace and optional pane context; when the
  target is an agent pane, Changes uses that agent's source-control context rather than assuming the
  workspace checkout is agent-owned

#### Scenario: Activate a host from a visual view

- **WHEN** an outgoing read-only context remains briefly visible after its host becomes inactive and
  the user invokes Switch now
- **THEN** the shell changes and revalidates the selected host through its existing connection
  lifecycle without treating the original entity selection as an operation

### Requirement: Agent-scoped source control context

When the Inspector's Changes tab is opened for a selected agent pane, World SHALL resolve and
display the source-control context of that agent from authoritative pane/session metadata and the
server-side local or SSH Git boundary. The context SHALL identify the agent pane, resolution
status/source, checkout or working path when available, repository, branch and changed-file summary.
World SHALL keep workspace-scoped Changes available as a separate explicitly labelled target.

Agent-scoped source-control reads SHALL be read-only in this capability. World SHALL NOT infer agent
ownership from the Inspector workspace, terminal CWD, or a sibling worktree when agent context is
missing or stale, and SHALL NOT silently show workspace changes as agent changes.

#### Scenario: Inspect an agent's separate checkout

- **WHEN** an agent pane reports a checkout or working directory that resolves to a Git checkout
  different from the selected Herdr workspace checkout
- **THEN** Changes identifies the selected agent, shows the resolved checkout context and reads the
  agent checkout's working or branch diff without replacing it with workspace changes

#### Scenario: Resolve from agent working directory

- **WHEN** the agent does not report an explicit checkout path but its foreground or base working
  directory resolves to a Git checkout
- **THEN** Changes marks the source as the agent working directory and uses that checkout for its
  read-only context and diff

#### Scenario: Agent checkout cannot be resolved

- **WHEN** the selected agent has no usable checkout metadata, its path is unavailable, or its path
  is not a Git checkout
- **THEN** Changes presents an explicit unavailable state with the reason and an optional,
  clearly-labelled action to inspect workspace Changes; it does not present workspace Changes as the
  agent's changes

#### Scenario: Preserve workspace Changes

- **WHEN** a user opens Changes from the workspace navigator or another non-agent workspace action
- **THEN** the existing workspace-scoped working, branch-main and last-step behavior remains
  unchanged and is not relabelled as agent-owned

#### Scenario: Agent context becomes stale

- **WHEN** an agent checkout disappears or changes between context resolution and a diff read
- **THEN** World reports the agent context as stale/unavailable and never redirects the read to a
  different checkout

#### Scenario: Read-only agent scope

- **WHEN** an agent-scoped Changes view exposes changed files and diff actions
- **THEN** it permits context, summary and file reads only, and does not expose or dispatch staging,
  commit, push, pull or other repository mutations
