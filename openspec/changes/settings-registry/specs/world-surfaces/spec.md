## ADDED Requirements

### Requirement: Settings registry preview

When the browser tab has the settings preview on (`?settings=next`, or a
`?setting=` link), World SHALL offer one Settings screen and one search over one
registry of settings, panels and commands. Each entry SHALL have a stable ID, a
category, a title and search words, and SHALL read and change its value through the
store that owns it today, so the value in Settings, on a view and in an older dialog
is one value. Features SHALL add entries from their own modules without changing the
Settings screen, the Menu or the command box; duplicate IDs SHALL fail at once.

The command box SHALL find the same settings and commands with the same search and
SHALL change a setting or run a command from a result. Commands the command box
offers SHALL be listed in the registry with the command box's admission: an action
it refuses SHALL be shown disabled with its reason, it SHALL run only through the
command box for the current connection, and the entries SHALL be withdrawn when the
command box unmounts. A control that stays on a view SHALL be listed and SHALL open
that view's control. An entry whose availability depends on another value SHALL
appear or disappear as soon as that value changes.

`?setting=<entry id>` SHALL open Settings at that entry and `?setting=<category>` at
that category; the parameter SHALL be removed from the address once read.
`?settings=off` SHALL turn the preview off. With the preview off, the Menu, dialogs
and command box SHALL behave as before.

#### Scenario: Find a view-only control

- **WHEN** a user with the preview on searches Settings or the command box for
  "lighting" or "night"
- **THEN** Town time of day is a result and choosing Night changes Town's lighting
  without opening Town's control

#### Scenario: One command inventory

- **WHEN** a user with the preview on searches Settings for "new workspace"
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
