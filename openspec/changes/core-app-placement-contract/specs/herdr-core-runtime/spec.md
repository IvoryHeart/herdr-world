## MODIFIED Requirements

### Requirement: World-started core terminals and confirmed kills

World SHALL start agents in core with an absolute host executable, no caller,
no parent, no notes and an explicit keep, placed in the apps by `herdr.space`,
`herdr.tab`, a `where` caption and an unseen `herdr.seen`; plain shells SHALL
start unplaced and not kept. Launches and placement moves into the same room
SHALL write the same machine-local space ID, with one tab ID per desk. Existing
app space and tab IDs SHALL be preserved when joining them. A `where` caption
SHALL describe placement for readers, without promising to name an app's space
or tab; app display names remain owned by its layout. World SHALL NOT write
the app's layout document or invent display-name labels to force adoption.
World's rooms, their order and the tabs it started SHALL live in World's SQLite
under the durable core ID. Before any native kill, room close or bin close,
World SHALL name every terminal core will end with it, bind each to the program
it saw (core, address, pid and argv) and send the kill only while its current
observation ends no more than that confirmed set.

#### Scenario: Agent launch

- **WHEN** a profile starts on a host with a connected core
- **THEN** core receives exactly those parameters, with app placement IDs and
  a readable caption, and World shows it in World's room

#### Scenario: Two tabs in one space

- **WHEN** World launches two agents into the same room
- **THEN** their core records carry one shared `herdr.space` and two distinct
  `herdr.tab` values, even when the app has not yet created that space
- **AND** World writes no app-owned layout or unsupported naming label

#### Scenario: Placement move

- **WHEN** World moves two unadopted desks into one room or joins an existing app desk
- **THEN** their labels identify that room and their respective destination
  desks, without restarting programs or replacing unrelated labels

#### Scenario: A child appears after the confirmation

- **WHEN** a die-with-parent child that World has observed was not in the
  confirmation, or a confirmed program was replaced (even reusing its pid)
- **THEN** World sends no kill, shows the new plan and asks again

#### Scenario: A child core creates after World's last observation

- **WHEN** core creates a child between World's last applied event and the kill
- **THEN** core's cascade may end it; core has no conditional kill (Q11)
- **AND** World's kill outcome names every unconfirmed terminal that ended or
  is ending in that cascade, never one that had ended before the kill

### Requirement: Distinguishable unnamed app spaces

World SHALL take explicit app space and tab names from the app-owned
`herdr-app` document, never from `where` captions. For unnamed app spaces,
World SHALL derive a display name once from the space's first terminal folder
(or the document's folder), else its tab, else its agent, and keep that name
while the space lasts. The row SHALL say the name is derived and views SHALL
mark it. A derived name another room of the same core already shows SHALL get
a number, kept when other rooms leave. World SHALL NOT write derived names
to core or change app ownership.

#### Scenario: Unnamed app space

- **WHEN** an app space has no explicit document name
- **THEN** its room reads a stable name derived from its first terminal's folder,
  the document folder, tab or agent, marked as derived
- **AND** with no evidence the room reads `Herdr space`

#### Scenario: Two rooms derive the same name

- **WHEN** two unnamed spaces of one core derive the same name
- **THEN** the later reads with a number, kept when the other room leaves

#### Scenario: World launches into an unnamed space

- **WHEN** World starts an agent in an unnamed app space
- **THEN** its caption retains the placeholder and never writes the derived name
- **AND** neither a World nor an app `where` caption supplies a room name

## ADDED Requirements

### Requirement: Read-only app placement authority

World SHALL observe the machine-local `herdr-app` document read-only on the
original core connection. Adopted terminal membership and explicit names SHALL
precede World placement and adoption labels in the unified World object.
Unadopted terminals SHALL retain World placement, label and ancestor fallbacks.
Local app document events and recovery cuts SHALL refresh the observation;
overtaken or retired-connection replies SHALL NOT restore old placement.
World SHALL NOT write the app document. World SHALL refuse placement moves
of adopted terminals or while app ownership cannot be established, explaining
that the person must move adopted terminals in Herdr's app. Desktop adoption
and phone Spaces are distinct acceptance boundaries (Q8 reopened); label
readback alone SHALL NOT be claimed as proof of app rendering.

#### Scenario: Adopted terminal disagrees with labels or World

- **WHEN** the app document places a live terminal in a different space or tab
- **THEN** every World view follows that document and its explicit names
- **AND** a World move of that terminal is refused before label writes

#### Scenario: Document absent or unreadable

- **WHEN** `doc.get` returns null
- **THEN** World falls back to existing World placement and adoption labels
- **WHEN** the document is unreadable or the method unavailable
- **THEN** World refuses moves rather than assuming no app has adopted a terminal

#### Scenario: Document changes during a read

- **WHEN** a newer local app document event or missed cut overtakes a read
- **THEN** its result cannot establish current ownership, and World reads again
- **AND** an unrelated or linked-machine document event cannot replace this core's layout

#### Scenario: App adoption during a move

- **WHEN** an app document change is observed after a placement write was dispatched
- **THEN** World rechecks ownership before saving placement or reporting success
- **AND** unknown or adopted ownership stops later writes and reports partial or
  uncertain placement without retry or rollback over the app's edits
