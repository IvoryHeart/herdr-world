# World settings

## Purpose

Define the user-facing settings contract across World views, preserving qualified runtime ownership and explicit failure behavior.

## Requirements

### Requirement: Help that ships with each feature

Each user-facing feature SHALL declare its help beside its code: a title,
what it is, at most five steps, where it lives, the control it points at and
the version it arrived in.

#### Scenario: Help that ships with each feature acceptance rules

- **WHEN** World presents settings, commands or feature help
- **THEN** World's help (**What can I do here?**), the Town
  Master's news, docs/HELP.md and the website's help page SHALL come from these
  declarations. Help SHALL open on the tab for the current screen and offer
  **Try** for each entry, which marks the control on screen, or the button that
  opens its menu when the control is inside a closed one, and says where to find
  it when it is not on this screen.

  Each declaration's pictures SHALL be generated from the synthetic scenes at
  phone and desktop sizes, in light and dark. The repository's help check SHALL
  fail, naming the entry, when an entry's control is no longer marked in any
  component, pictures are missing, or pictures are orphaned. Stale picture input
  fingerprints SHALL warn without failing feature PRs. Feature PRs SHALL capture
  only entries they add or change; other UI changes SHALL leave pictures alone.
  After pushes to main, stale fingerprints SHALL cause one bot PR to regenerate
  pictures, their manifest and docs/HELP.md. The bot SHALL update that PR, label it
  for the owner's merge rule and dispatch its checks; it SHALL never push to main.
  The PR description check SHALL fail when a change fragment adds something
  without a changed help declaration or a stated reason.

#### Scenario: A control is renamed

- **WHEN** a component stops marking a control that a help entry points at
- **THEN** the help check fails and names the entry and the control

#### Scenario: A pictured style changes

- **WHEN** a stylesheet or component that the picture stage renders changes
  and the pictures are not regenerated
- **THEN** the feature PR's help check warns and passes if structure is valid
- **AND** the feature PR need not regenerate any pictures
- **AND** after merge, the main workflow refreshes pictures in one bot PR

#### Scenario: A new help entry has no picture

- **WHEN** a feature declares a new help entry without its required pictures
- **THEN** the help check fails and names the entry

#### Scenario: The refresh PR merges

- **WHEN** regenerated pictures and fingerprints merge to main
- **THEN** the freshness check passes and no further refresh PR is created

#### Scenario: What can I do here?

- **WHEN** the user opens help on Town, Board or Chat
- **THEN** help shows that place's entries, each with a picture and Try

### Requirement: Settings home and short Menu

World SHALL offer one Settings screen and one search over one registry of settings,
panels and commands, and Settings SHALL be the common settings menu.

#### Scenario: Settings home and short Menu acceptance rules

- **WHEN** World presents settings, commands or feature help
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
