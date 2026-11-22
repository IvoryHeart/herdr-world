## MODIFIED Requirements

### Requirement: Settings home and short Menu

World SHALL offer one Settings screen and one search over one registry of settings,
panels and commands, and Settings SHALL be the common settings menu.

#### Scenario: Settings home and short Menu acceptance rules

- **WHEN** World presents or operates this feature
- **THEN** Each entry SHALL
  have a stable ID, a category, a title and search words, and SHALL read and change its
  value through the store that owns it, so the value in Settings and on a view is one
  value. Features SHALL add entries from their own modules without changing the Settings
  screen, the Menu or the command box; duplicate IDs SHALL fail at once. Every setting
  and command SHALL be reachable from Settings; there SHALL be no second configuration
  dialog.

  The Menu SHALL list only Settings, Find or act, Zen mode, Help, Upgrade (when an
  update is offered) and Log out (when the server requires a password), on desktop and
  phone. Help SHALL open Settings at its Help category.

  The command box SHALL find the same settings and commands with the same search and
  SHALL change a setting or run a command from a result. Commands the command box
  offers SHALL be listed in the registry with the command box's admission: an action
  it refuses SHALL be shown disabled with its reason, it SHALL run only through the
  command box for the current connection, and the entries SHALL be withdrawn when the
  command box unmounts. A control that stays on a view SHALL be listed and SHALL open
  that view's control. An entry whose availability depends on another value SHALL
  appear or disappear as soon as that value changes. A dialog opened from a Settings
  row SHALL return to Settings at that row when it closes.

  `?setting=<entry id>` SHALL open Settings at that entry and `?setting=<category>` at
  that category; the parameter SHALL be removed from the address once read. The retired
  `?settings=` preview parameter SHALL be removed from the address and SHALL change
  nothing.

#### Scenario: Find a view-only control

- **WHEN** a user searches Settings or the command box for "lighting" or "night"
- **THEN** Town time of day is a result and choosing Night changes Town's lighting
  without opening Town's control

#### Scenario: One command inventory

- **WHEN** a user searches Settings for "new workspace"
- **THEN** Settings lists the command box's Create workspace, runs it through the
  command box, and shows it disabled with the refusal reason when the active
  connection cannot create workspaces

#### Scenario: Open a setting by link

- **WHEN** a user opens World at `?setting=appearance.terminal-font-size`
- **THEN** Settings opens at Terminal font size, the address loses the parameter,
  and a reload does not open Settings again

#### Scenario: Unknown link

- **WHEN** a user opens World at `?setting=` with an ID no entry or category has
- **THEN** Settings opens at its All tab and no setting changes

#### Scenario: Old preview link

- **WHEN** a user opens World at `?settings=next`
- **THEN** World opens as usual with the short Menu, and the address loses the
  parameter

#### Scenario: Return from a dialog

- **WHEN** a user opens Layout from Settings and closes it
- **THEN** Settings opens again at the Layout row with focus on its Open button
