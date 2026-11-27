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

- **WHEN** World moves two desks into one room or joins an existing app desk
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
