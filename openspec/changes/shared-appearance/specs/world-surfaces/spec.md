## ADDED Requirements

### Requirement: Shared terminal appearance

World SHALL provide a common appearance editor from terminal title bars on desktop
and phone, reachable from Board, Town, Desk and Spaces. It SHALL edit the native
tab name, the tab's shared palette colour, a plain-text status message of at most
160 characters and a fixed-choice avatar for the selected pane. Workspace icons
and workspace status messages SHALL remain outside this editor. Split panes SHALL
share tab name/colour/status and retain independently chosen avatars. Reset SHALL
remove only the chosen override and restore existing colour/profile defaults.

Native names SHALL be changed through the exact connection's current Herdr
`tab.rename`. The header SHALL display the native tab name; World SHALL NOT keep
a shadow name. Failed saves SHALL remain visible and SHALL NOT be reported as
successful. Native rename and World metadata results SHALL remain distinguishable.

Appearance SHALL be saved in the World service and shared across browsers/views.
The identity SHALL include immutable connection profile ID, entity kind/native ID
and terminal-ID continuity evidence. Writes SHALL verify the observed target on
the captured current runtime and refuse conflicting/reused IDs or retired reads.
Unavailable hosts SHALL NOT authorize writes, rebind metadata or prove deletion.
Bound choices SHALL be projected only onto matching current terminal evidence.
Legacy Board colours SHALL migrate without introducing a second colour authority.
Complete current evidence that all of a record's terminal witnesses are absent
SHALL reclaim that record and its colour alias. A read admitted before a newer
metadata edit SHALL NOT prune that edit. A moving terminal that remains present
SHALL retain its choices, including after a lost move acknowledgement.
An unsaved editor draft SHALL remain bound to its original native tab and pane;
moving that pane into another tab SHALL NOT retarget the draft.

Board SHALL show avatar/status on the tab card, Town SHALL use the avatar for the
agent and show the status near its desk, Spaces SHALL show the avatar and include
the status in its tab tooltip, and Desk SHALL show the same appearance. Manual
status/colour SHALL NOT alter runtime state badges, their meanings or colours.
Avatar choices SHALL use existing bounded assets and SHALL NOT accept uploads.

#### Scenario: Two browsers share one tab's choices

- **WHEN** an operator changes colour and status in a terminal header
- **THEN** both browsers and all views show the saved values without changing runtime status

#### Scenario: Split panes keep independent avatars

- **WHEN** two panes of one tab choose different avatars and the tab is renamed
- **THEN** both headers show the same native tab name and colour/status while each pane retains its own avatar

#### Scenario: Reused IDs cannot inherit bound appearance

- **WHEN** a current tab or pane reuses a native ID with no continuing witnessed terminal
- **THEN** the previous occupant's bound appearance is not projected and a stale editor cannot overwrite the new occupant

#### Scenario: Runtime retires during validation

- **WHEN** the runtime retires while validating an appearance edit
- **THEN** no document mutation or native rename is authorized by that retired read

#### Scenario: Reset restores existing defaults

- **WHEN** an operator resets a pane avatar or a tab colour/status override
- **THEN** only that field is removed, restoring its profile/identity or existing colour inheritance and leaving the other pane's choices intact

#### Scenario: Save fails

- **WHEN** native rename or metadata persistence fails
- **THEN** the editor exposes that operation's failure and does not show a successful shadow name or discard unsaved input

#### Scenario: Stale observation is not deletion

- **WHEN** a host becomes unavailable or observation is incomplete
- **THEN** saved metadata remains retained without rebinding or becoming actionable

## MODIFIED Requirements

### Requirement: Terminal colour

Every Herdr tab SHALL have one terminal colour from a fixed palette, shown as
its tab in Spaces, its card in Board and, when Town draws a table for it, that
table; a tab beyond a room's drawn tables keeps its colour in Spaces and Board.
Without a choice of its own a tab SHALL take the colour of the tab whose agent
spawned it (a spawn relation, never a manual group), then its workspace's Board
colour, if any, or else a default derived only from its connection and Herdr
tab ID, so it is the same on every device and after reloads. A colour chosen in any view
SHALL be saved by the World service, keyed by connection and Herdr tab ID (as
Board keys a tab card, qualified when the tab ID is also a workspace ID),
SHALL appear in every view and on every device, and MAY be reset; reset is
offered only for a tab's own colour, not one inherited from its workspace. The saved choice SHALL carry terminal-ID continuity evidence after migration.
A conflicting current occupant of a reused tab ID SHALL NOT inherit it. Legacy
choices without evidence SHALL be adopted only from a complete current
observation; migration cannot reconstruct their earlier identity. A tab World moves to another workspace SHALL keep
the colour it showed, whether chosen, inherited or default, saved as its own
colour, except a colour inherited from its spawning tab, which follows its
terminals and is not saved. When World observes
Herdr close a tab on the connection's current runtime, it SHALL drop that tab's
saved colour. Terminal colour SHALL never stand for or hide a status. World
SHALL NOT write a colour to Herdr.

A terminal's colour SHALL be shown, and offered for change, beside its name in
the terminal's header (the window header on desktop, the app bar on a phone)
and in the terminal window's menu, as well as in the Spaces tab menu, the Town
peek and Board. Every picker SHALL be the same palette with **Default colour**,
opened as a transient layer.

Workspaces and hosts SHALL have colours of their own from the same palette,
saved by the World service with terminal colours: a workspace's under its Board
card key, a host's under a key no card can have. A workspace's colour SHALL be
offered and shown on its Board card, on its Town room (carpet and room card,
with the picker beside the room's name) and in the Spaces sidebar (a dot before
its name, the palette in its menu). A host's colour SHALL be offered and shown
on its Town building (roof, with the picker on its reception board), its Board
zone and its Spaces sidebar header. Without one, a workspace SHALL show its
default (Town's carpet, no Board tint) and a host its theme. A tab without a
colour of its own SHALL take its workspace's chosen colour, then its own
default; a host's colour SHALL NOT be inherited, so tabs keep their varied
defaults. No inherited colour SHALL overwrite a chosen one, and each place's
own colour MAY be reset.

#### Scenario: Colour a workspace and a host

- **WHEN** the user picks teal for a workspace and pink for its host
- **THEN** the workspace's Town carpet, Board card and Spaces dot show teal, its
  tabs without a colour of their own show teal, the host's Town roof, Board zone
  and Spaces header show pink, and no tab shows pink because of the host

#### Scenario: Colour a tab in Spaces

- **WHEN** the user picks pink from a tab's menu in Spaces
- **THEN** the tab's strip in Spaces, its table in Town and its card in Board show pink on every device

#### Scenario: Colour a terminal from its header

- **WHEN** the user opens the colour swatch beside a terminal's name and picks green
- **THEN** the terminal shows green in its header, Spaces, Town and Board, and the picker closes

#### Scenario: Reset a tab's colour

- **WHEN** the user chooses Default colour for a tab with a chosen colour
- **THEN** every view shows the tab's default colour again

#### Scenario: Move a desk without a chosen colour

- **WHEN** the user moves a desk whose tab shows its default colour to another room
- **THEN** the tab, under its new Herdr tab ID, shows the same colour in every view
