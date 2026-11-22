# World appearance

## Purpose

Define the user-facing appearance contract across World views, preserving qualified runtime ownership and explicit failure behavior.

## Requirements

### Requirement: Shared terminal appearance

World SHALL provide a common appearance editor from terminal title bars on desktop
and phone, reachable from Board, Town, Desk and Spaces.

#### Scenario: Shared terminal appearance acceptance rules

- **WHEN** World reads, edits or projects terminal appearance and assignments
- **THEN** It SHALL edit the native
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

### Requirement: Terminal colour

Every Herdr tab SHALL have one terminal colour from a fixed palette, shown as
its tab in Spaces, its card in Board and, when Town draws a table for it, that
table; a tab beyond a room's drawn tables keeps its colour in Spaces and Board.

#### Scenario: Terminal colour acceptance rules

- **WHEN** World reads, edits or projects terminal appearance and assignments
- **THEN** Without a choice of its own a tab SHALL take the colour of the tab whose agent
  spawned it (a spawn relation, never a manual group), then its workspace's Board
  colour, if any, or else its workspace's default, derived only from its
  connection and Herdr workspace ID, so every tab of a room without colours shows
  one colour, the same on every device and after reloads. No tab SHALL have a
  default of its own. A colour chosen in any view
  SHALL be saved by the World service, keyed by connection and Herdr tab ID (as
  Board keys a tab card, qualified when the tab ID is also a workspace ID),
  SHALL appear in every view and on every device, and MAY be reset; reset is
  offered only for a tab's own colour, not one inherited from its workspace. The saved choice SHALL carry terminal-ID continuity evidence after migration.
  A conflicting current occupant of a reused tab ID SHALL NOT inherit it. Legacy
  choices without evidence SHALL be adopted only from a complete current
  observation; migration cannot reconstruct their earlier identity. A tab World moves to another workspace SHALL keep
  its own chosen colour, saved under its new tab ID; without one it SHALL take
  its new workspace's colour, and a colour inherited from its spawning tab
  follows its terminals; neither is saved. When World observes
  Herdr close a tab on the connection's current runtime, it SHALL drop that tab's
  saved colour. Terminal colour SHALL never stand for or hide a status. World
  SHALL NOT write a colour to Herdr.

  Colour SHALL be quiet identity and status the only loud colour. Every palette
  tone SHALL share one lightness and a low chroma, so that every status colour of
  the agent marks, in the dark and light themes, is at least 1.75 times as
  chromatic as any palette tone, and each tone SHALL keep 3:1 contrast against
  the dark, light and white surfaces. Each status SHALL also be shown by its own
  glyph and word (the agent marks), never by colour alone.

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
  colour of its own SHALL take its workspace's chosen colour, then its
  workspace's default; a host's colour SHALL NOT be inherited. No inherited colour SHALL overwrite a chosen one, and each place's
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
- **THEN** every view shows the tab's room's colour again

#### Scenario: Move a desk without a chosen colour

- **WHEN** the user moves a desk whose tab has no colour of its own to another room
- **THEN** the tab, under its new Herdr tab ID, shows its new room's colour in
  every view, like the room's other tabs without a colour

#### Scenario: A room without colours reads as one place

- **WHEN** a room has several tabs and nobody has chosen a colour for the room
  or its tabs
- **THEN** every one of its tabs shows the same muted colour in Spaces, Town and
  Board, and only an agent's status mark is drawn in a saturated colour

### Requirement: Per-terminal settings live with the terminal

**Where they live.** A terminal's profile assignment and the Town master role SHALL be
kept in Herdr metadata reported on that terminal's pane, not in World's files.

#### Scenario: Per-terminal settings live with the terminal acceptance rules

- **WHEN** World reads, edits or projects terminal appearance and assignments
- **THEN** Every
  World connected to that Herdr SHALL then read the same settings, and the settings SHALL
  end when the terminal ends, including on a Herdr restart.

  **Token rules.** World SHALL write these settings as namespaced tokens that:
  - name the terminal they were written for;
  - stay within Herdr's per-terminal token limits;
  - carry no TTL.

  World SHALL honour the tokens only while the pane holds that terminal. Before writing,
  World SHALL check that every value is non-empty, trimmed, free of control characters and
  within Herdr's value length, so that Herdr never silently changes it.

  **Writes.** World SHALL write only through the exact connection's current runtime
  lease. It SHALL first confirm that the pane still holds the expected terminal, and
  SHALL revalidate the lease after writing. A failed or refused write SHALL be shown and
  SHALL NOT be reported as saved. After a move World performs, it SHALL keep the settings
  on the moved terminal.

  **Unreachable hosts.** A host that is unreachable or stale SHALL leave its terminals'
  settings unresolved, never cleared.

  **Profiles.** Profiles and chimes SHALL stay owned by each World, persisted
  through its SQLite storage port. Current terminal assignments remain Herdr-owned.
  - A shared assignment SHALL resolve against this World's profiles.
  - An assignment naming a profile this World lacks SHALL show the recorded profile name
    with the default look.

  **Town master.** At most one agent SHALL hold the Town master role across every host a
  World observes, and the newest assignment SHALL win.
  - A new claim's revision SHALL be the later of the current wall time and one more than
    the highest revision that World has observed or written. World SHALL remember that
    highest revision across its restarts.
  - The claim with the highest revision SHALL win; a tie SHALL go to the greater terminal
    ID.
  - World SHALL clear superseded claims where it holds a current lease.
  - Moving the role away from another live agent SHALL still ask the user first.

  **Migration.** World SHALL import each existing assignment once, when its connection is
  first observed complete on a ready runtime after this change. It SHALL:
  - drop an assignment whose terminal is absent from that observation;
  - keep the assignments of hosts not yet observed until they are;
  - record per connection that the import is done, so that no later start imports it
    again.

#### Scenario: Two Worlds share one Herdr
- **WHEN** the user launches an agent from a profile in one World while another World
  observes the same Herdr
- **THEN** both Worlds show that terminal's assignment, and the second World uses its
  own profile of that ID or, without one, the recorded name with the default look

#### Scenario: Herdr restarts
- **WHEN** Herdr restarts and restores its panes with new terminals
- **THEN** no restored pane carries the old assignment or Town master role

#### Scenario: Pane moved by World
- **WHEN** World moves an agent's pane to another desk
- **THEN** the terminal keeps its assignment and role under its new pane ID

#### Scenario: Host offline
- **WHEN** a host holding the Town master goes offline and nothing else changes
- **THEN** World keeps that claim unresolved, does not clear it, and resolves it again
  when the host returns

#### Scenario: The offline holder returns after a newer assignment
- **WHEN** the user gives the role to an agent on another host while the previous
  holder's host is offline, and that host later returns
- **THEN** the newer assignment keeps the role, and the returning claim is cleared as
  superseded

#### Scenario: World restarted while the holder was offline
- **WHEN** World restarts while the holder's host is offline, and the user then assigns
  the role to another agent before that host returns
- **THEN** the new assignment wins when the host returns, because its revision is newer

#### Scenario: Town master assigned in two Worlds
- **WHEN** two Worlds assign the role to different agents and each then observes both
  claims
- **THEN** both Worlds show the same holder, decided by revision and then terminal ID,
  and the superseded claim is cleared

#### Scenario: A value Herdr would change
- **WHEN** a profile name contains control characters or is longer than Herdr keeps
- **THEN** World writes a cleaned, shortened name it has validated, never a value Herdr
  would silently truncate

#### Scenario: Restart after a newer assignment
- **WHEN** World restarts after an imported assignment was replaced through the tokens
- **THEN** World does not import the legacy assignment again, and the newer assignment
  stays

#### Scenario: Write fails
- **WHEN** Herdr refuses the token write, including past its per-terminal key limit, or
  the runtime retires during it
- **THEN** World shows the failure, does not show the setting as saved, and leaves the
  previous setting in place
