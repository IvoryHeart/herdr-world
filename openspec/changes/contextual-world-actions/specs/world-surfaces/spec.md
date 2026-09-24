## ADDED Requirements

### Requirement: World command actions

The shared top-bar command palette SHALL use one query surface for World entity search and the
complete model action catalog across Spaces, Office, Tree and Graph. The existing workspace, tab,
pane, file, worktree and dialog actions SHALL remain available from every projection and SHALL
continue to use their shared model callbacks and capability guards. A visual route SHALL add an
explicit World dispatcher for actions that require a generation-qualified visual target, including
resource Inspectors whose presentation belongs to the active visual surface; no action SHALL be
routed to the hidden Spaces terminal surface merely because the inherited callback is defined
there.

Every handled visual action SHALL preserve the current canonical World view and selected host. A
terminal-focus action SHALL resolve its target from the selected-host `WorldObject`, exact-focus
the owning workspace/pane through the existing qualified focus path, and open or focus the shared
Inspector/Terminal presentation for that entity. It SHALL publish no Inspector identity or resource
content until focus succeeds, and stale, foreign, missing, or rejected targets SHALL fail closed.

#### Scenario: Search World entities and actions together

- **WHEN** a user opens the top-bar command palette from Office, Tree, Graph, or Spaces and enters
  a World entity or action query
- **THEN** matching World entities and available actions appear in the same query surface with the
  same model action availability and no second stage search header

#### Scenario: Use a shared model action from a visual view

- **WHEN** a user searches for and selects `Close pane`, `Create tab`, file browsing, or a
  worktree action while Office, Tree, or Graph is active
- **THEN** the existing confirmation, dialog, or shared model callback runs with the same
  endpoint and capability guards as in Spaces, while the current visual view remains active; file
  browsing and diff actions open the qualified World Inspector resource instead of updating an
  unrendered Spaces-only Inspector

#### Scenario: Open a workspace resource from a visual view

- **WHEN** a user selects `Open file explorer` or `Open Diff Viewer` for the current workspace while
  Office, Tree, or Graph is active
- **THEN** World resolves the selected current-generation workspace, focuses it through the
  qualified World path, and opens the Files or Changes resource in the existing visual Inspector
  without changing the current view or selected host

#### Scenario: Focus a tab from a visual view

- **WHEN** a user selects `Focus tab` for a tab in the selected operational host while Office,
  Tree, or Graph is active
- **THEN** World resolves that tab to its exact current-generation pane, focuses it through the
  qualified World path, opens or focuses its existing Terminal Inspector, and leaves the current
  view and selected host unchanged

#### Scenario: Focus an agent from a visual view

- **WHEN** a user selects a pane/agent focus action while a visual route is active
- **THEN** World resolves the exact selected-host pane, admits the corresponding Inspector only
  after successful focus, and leaves Spaces hidden and unattached for that terminal

#### Scenario: Model focus action from a visual view

- **WHEN** a user selects a workspace, tab, pane-direction, zoom, or other model action while a
  visual route is active
- **THEN** the action runs against the shared model through its existing callback, the current
  visual route remains active, and no second hidden Spaces terminal is attached

#### Scenario: Visual action target becomes stale

- **WHEN** a visual action's target disappears, changes generation, belongs to another host, or its
  exact focus is rejected
- **THEN** World reports the existing bounded action error, leaves the current view and host
  unchanged, and publishes no target identity or resource from the failed admission

## Unchanged Requirements

All existing World surface, selected-host, Inspector, terminal ownership, accessibility, and
Spaces-handoff requirements remain in force.
