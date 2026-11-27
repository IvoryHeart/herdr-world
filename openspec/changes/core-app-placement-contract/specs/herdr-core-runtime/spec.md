## MODIFIED Requirements

### Requirement: World-started core terminals and confirmed kills

World SHALL start agents in core with an absolute host executable, no caller,
no parent, no notes and an explicit keep; plain shells SHALL start unplaced and
not kept. Agent launches SHALL use machine-local app space/tab IDs and initial
unseen `herdr.seen`.

#### Scenario: Core launch placement and confirmed teardown

- **WHEN** World starts or ends core terminals
- **THEN** shared placement SHALL be committed in the core's
  `herdr-app` document; `herdr.space`/`herdr.tab` SHALL be compatibility adoption
  hints and `where` an output caption only. Joining existing app spaces/tabs
  SHALL preserve their IDs and unrelated content. Core rooms, tab membership,
  names and order SHALL have no competing authoritative World layout. Before
  any native kill, room close or bin close, World SHALL name every terminal
  core will end with it, bind each to the program it saw (core, address, pid and
  argv) and send the kill only while its current observation ends no more than
  that confirmed set.

#### Scenario: Agent launch

- **WHEN** a profile starts on a host with a connected core
- **THEN** core receives those launch parameters and World adopts the terminal
  into the shared app document with `keep:true`
- **AND** World and Herdr's apps use that document's placement and names

#### Scenario: Two tabs in one space

- **WHEN** World launches two desks into the same requested space
- **THEN** the document holds one space and two distinct tabs with their panes,
  and label readback agrees with those machine-local IDs
- **AND** an existing layout survives, or an absent one is created using the
  version returned by its successful read

#### Scenario: A child appears after the confirmation

- **WHEN** a die-with-parent child that World has observed was not in the
  confirmation, or a confirmed program was replaced (even reusing its pid)
- **THEN** World sends no kill, shows the new plan and asks again

#### Scenario: A child core creates after World's last observation

- **WHEN** core creates a child between World's last applied event and the kill
- **THEN** core's cascade may end it; core has no conditional kill (Q11)
- **AND** World's kill outcome names every unconfirmed terminal that ended or
  is ending in that cascade, never one that had ended before the kill

### Requirement: Shared app state with independent World ownership

World SHALL own asks/results, review receipts and view geometry; core room
membership, names and tab order SHALL come from the shared `herdr-app`
document, replacing M1/M2's independent core arrangement. Other
[M1–M11 ownership decisions](../../../archive/2026-11-17-herdr-core-runtime/design.md)
SHALL remain applicable.

#### Scenario: Core placement, pins and destructive authority

- **WHEN** World shares app state or manages core terminals
- **THEN** World SHALL share seen and the pin. A core tab's desk and
  card SHALL be pinned exactly while one of its terminals carries
  `herdr.pinned`; Herdr (TUI) tabs keep World's own pin. Pinned SHALL mean
  pinned goes first, as in Herdr's apps: World derives a pinned card's place
  from the pin and tab order and saves none; a Town room's pinned desks keep
  the order the person gave them on its rug as World's own view layout (Herdr's
  apps have no order for pins), else tab order. World SHALL read
  agent status from core and SHALL NOT write it, including for integrations World
  installed. Native destructive actions SHALL confirm all dying descendants,
  including ending a room shell, and a confirmation SHALL name each terminal's
  occupant incarnation (the mirror's occupancy token), so a replacement that
  reuses the pid and argv is refused.

#### Scenario: Town moves core agents and desks by placement

- **WHEN** a user drags a live core agent onto another desk in its room or
  another room, or moves its whole desk to another room on the same connection
- **THEN** World commits the selected placement to the shared app document,
  creating missing requested spaces/tabs and preserving existing app content,
  then refreshes compatibility labels and output captions from that placement
- **AND** running terminals retain their addresses, programs and unrelated
  labels; a one-agent move leaves unselected inherited children in their
  source room, and a desk move includes every observed terminal at the desk
- **AND** moves serialize per durable core while retaining the original
  connection generation, core epoch and terminal occupants; queued moves
  reread placement and every write checks the original authority
- **AND** Spaces remain when emptied and no app space is closed
  by a placement move, so the TUI's room-closing consent does not apply;
  joining a team across rooms can move the core desk to its teammate

#### Scenario: Core movement cannot complete

- **WHEN** required document/adoption methods are unavailable, the connection
  is stale, the layout is invalid, or a source/destination has disappeared
- **THEN** Town shows the specific reason and never falls back to a TUI runtime
- **AND** if a write has been sent and a later step fails or its reply is lost,
  the outcome reports partial or unknown placement instead of success or a
  claim that nothing changed; World never retries uncertain writes or rolls
  back over another client's placement edits
- **AND** document tab order remains shared, while pinned desks retain
  World's saved ordering among their room's pinned seats

#### Scenario: Review a finished turn

- **WHEN** a finished turn becomes visibly seen in foreground World
- **THEN** shared seen clears done in the apps while blocked/error precedence,
  missing-seen semantics and explicit unread remain respected

#### Scenario: Unread elsewhere while World looks

- **WHEN** another Herdr client marks a turn unread while a World page still
  shows the agent, or changes `herdr.seen` after World decided to write
- **THEN** World keeps it unread until a new turn or a new look and writes no
  label other than the one its look was decided on

#### Scenario: One pin and push

- **WHEN** a person pins or unpins a core agent's desk, card or peek in World,
  or pins or unpins it in a Herdr app
- **THEN** `herdr.pinned` changes and every client shows it: World's pin pins
  the tab's agents (its terminals when it has none) and its unpin clears every
  terminal in the tab; the desk and card wear World's pin while any terminal
  is pinned; pinned goes first: a room's pinned desks take its first seats in
  tab order on one shared rug, reordered only among themselves there (a drop
  off the rug goes back; a drag never unpins), a workspace's pinned cards sit first, above it
  in tab order on one band, unpinning returns tab order, and pinned agents
  come first in lists with no order of their own (a phone's switch list,
  Desk's quiet agents, agent pickers); a stale host shows its
  last pins and refuses changes; review
  receipts stay World-only; a core agent that finishes after working or
  starts needing the user triggers a push from core status events under Herdr's
  attention rule

#### Scenario: Missing agent status

- **WHEN** a harness has no reported status or its reporting times out, including
  a harness whose integration World installed
- **THEN** World leaves status unknown and never injects or writes status to core

#### Scenario: Headless run and wrapper

- **WHEN** a terminal runs `claude -p …` directly, or `bash run.sh` runs it in
  the same foreground group on a core on this machine
- **THEN** the desk shows Claude working while that process lives, looking as
  if started directly; a wrapper running only `git` or `bun test` stays a plain
  terminal

#### Scenario: Stale working report

- **WHEN** an agent reported working and is killed mid-turn, leaving a shell,
  an editor or a wrapper with no harness in its group in front
- **THEN** World shows it idle and never writes status to core

#### Scenario: Replacement inherits no report

- **WHEN** a wrapper's agent that reported working exits and another harness,
  or a new process of the same harness, starts in its place without reporting
- **THEN** the desk shows the newcomer unknown (working, if headless), never
  the departed agent's word

#### Scenario: Headless run ends inside its wrapper

- **WHEN** a headless run World saw inside a wrapper exits while the wrapper
  stays in front
- **THEN** the desk keeps that agent, idle, so Town walks it to the bar; when
  another program leads the terminal, the desk is a plain terminal again

#### Scenario: Unread group is no exit

- **WHEN** World saw an agent inside a wrapper and one later read of the
  wrapper's foreground group fails
- **THEN** the desk keeps that agent, its report and, for a headless run, its
  working status, never an earlier reporter's name; only a group read without
  it, or another program leading the terminal, counts as its exit

### Requirement: Distinguishable unnamed app spaces

World SHALL take explicit core space and tab names from the `herdr-app`
document, never from `where`. For an unnamed space World SHALL retain stable
display-only derived-name memory, markers and collision suffixes, using its
first terminal's folder or document folder, else tab or agent evidence. That
fallback SHALL NOT create a second placement authority or write a derived name
into the document. Without evidence its name SHALL be `Herdr space`.

#### Scenario: Unnamed space display continuity

- **WHEN** World names an unnamed app-created core space
- **THEN** World SHALL keep that name
  while the space lasts, so agents coming and going, in that room or another,
  never change it. The row SHALL say the name is derived and views SHALL mark it.
  A derived name another room of the same core already shows SHALL get a number,
  kept when other rooms leave. World SHALL NOT write the derived name to core and
  SHALL NOT change the space's owner.

#### Scenario: Unnamed app space

- **WHEN** an app space has no explicit document name
- **THEN** World shows its stable derived name and marker from folder or other
  fallback evidence, ignoring captions
- **AND** an explicit document name replaces the fallback when supplied

#### Scenario: Two rooms derive the same name

- **WHEN** two unnamed spaces of one core derive the same name
- **THEN** the later reads with a number kept when the other room leaves

#### Scenario: World launches into an unnamed space

- **WHEN** World starts an agent in an unnamed app space
- **THEN** it retains the empty explicit name and writes only an output caption,
  never promoting a derived name to an app name

## ADDED Requirements

### Requirement: Shared app placement observation

World SHALL observe the machine-local `herdr-app` document on its original
immutable connection and runtime generation. Its spaces, order, tabs and
terminal membership SHALL feed the unified World object used by every view.

#### Scenario: Placement precedence and refresh

- **WHEN** World observes core placement
- **THEN** document membership SHALL precede labels, legacy World placement
  and parent relations. Uncovered terminals, including on a core with no document, SHALL
  group by working folder and display its folder name. Local app `doc` events,
  recovery cuts and reconnects SHALL refresh observation; overtaken or retired
  replies SHALL NOT restore older layout. An unavailable or invalid document
  SHALL NOT be treated as absent or authorize edits.

#### Scenario: App layout disagrees with labels

- **WHEN** a terminal's document membership differs from its labels or legacy
  World layout
- **THEN** Town, Desk, Board and other consumers follow the document
- **AND** an external document move or rename reaches them through World

#### Scenario: No app document

- **WHEN** a successful read returns null and no adoption has run
- **THEN** terminals in one working folder share a folder-named room
- **AND** distinct crew worktrees stay distinct groups regardless of labels,
  captions or parentage

#### Scenario: Document changes during a read

- **WHEN** a local document notification or recovery cut overtakes a read
- **THEN** World refreshes instead of publishing the overtaken result
- **AND** linked-machine or other-document events cannot substitute a layout

### Requirement: Cooperative app layout edits and migration

World SHALL create missing requested spaces and apply explicit moves/renames
in the exact app document schema, preserving unknown fields and unrelated
content at every level. Every write SHALL supply the version just read.

#### Scenario: Cooperative edit safeguards

- **WHEN** World edits the shared app layout
- **THEN** on a definite version conflict World SHALL reread and reapply its intent, preserving
  concurrent edits; it SHALL NOT blindly overwrite or replay an ambiguous write.
  World SHALL set `keep:true` on adopted terminals as the app does. World SHALL
  NOT delete or rename a space/tab it did not create unless the owner requests
  that specific change in World. Unknown provenance SHALL count as foreign.

#### Scenario: Migration preserves existing layout

- **WHEN** World migrates legacy placement into the shared app layout
- **THEN** migration SHALL preserve existing app membership/names, import
  missing legacy World rooms and unadopted labelled terminals idempotently, and publish the
  requested Crew space with its desk tabs. Migration SHALL NOT recover names
  from `where`, restart terminals, or maintain another arrangement above the
  document. Acknowledged migration SHALL NOT resurrect app-deleted rooms from
  stale legacy data. Labels alone SHALL NOT count as proof of phone rendering;
  Q8 SHALL remain open until desktop and phone acceptance is observed.

#### Scenario: Desktop edits during a World move

- **WHEN** the desktop changes the document after World's read
- **THEN** the stale version fails, World rereads and reapplies only its move
  to the latest version, preserving unrelated and unknown fields
- **AND** a concurrently moved/removed target causes a visible refusal instead
  of undoing the desktop edit

#### Scenario: Foreign room protection

- **WHEN** adoption or migration encounters an existing space/tab
- **THEN** its name, identity and unrelated layout survive
- **AND** only a specific owner rename/delete action can authorize such a change
  to a foreign space/tab; moving its last pane does not prune it

#### Scenario: Linux core with no document

- **WHEN** World runs the authorized initial writable migration for the
  reported labelled crew desks
- **THEN** it creates Crew with distinct desk tabs and kept terminals through
  a versioned write, without dispatcher changes
- **AND** observations use the document, not World's legacy grouping

#### Scenario: Unknown write result

- **WHEN** a document write times out or disconnects without a definite result
- **THEN** World reports uncertainty and reconciles by reading, without replay
  or restoring an earlier document over another editor
