## ADDED Requirements

### Requirement: Sources of record

World SHALL derive every fact it shows from a named source of record: the runtimes
(Herdr TUI and herdr-core), git and forges, harness files, deployments, integrations
and the Vault, World's own stores, and other files World reads. Each fact SHALL have
exactly one source of record. When a fact has a World record and a runtime mirror,
the World record SHALL be the source of record and World SHALL write the mirror.

#### Scenario: A source and World disagree
- **WHEN** World's value for a runtime-owned fact differs from what the runtime holds
- **THEN** the next observation replaces World's value with the runtime's

#### Scenario: A mirror differs from its record
- **WHEN** a runtime metadata token that mirrors a World record differs from that record
- **THEN** World's record stays authoritative and World rewrites the mirror

### Requirement: One World object derived on the service

The World service SHALL derive one World object from the sources of record, with one
revision that rises whenever a derived fact changes. Views, the CLI, Ranger and
notifications SHALL read facts from that object. Rules that turn sources into facts
(names, colours, looks, grouping, status, attention, counts, relations, interest,
pins) SHALL run once, on the service.

#### Scenario: The CLI and a view show the same agent
- **WHEN** the CLI lists an agent that Town also shows
- **THEN** both show the same name, colour, group, status and pin from one revision

### Requirement: Views display World

A view SHALL NOT keep its own copy of World state, SHALL NOT derive a World fact in its
own code, and SHALL NOT store a World fact in browser storage or the page address.
Each browser SHALL hold one replica of the World object, shared by its views, and SHALL
adopt a World object only when its revision is newer than the one it holds.
Presentation that no other view, browser or the CLI needs to agree on (camera, zoom,
selection, open windows, drafts, per-view themes) MAY stay in the browser.

#### Scenario: A late reply arrives
- **WHEN** a browser receives a World object older than the one it holds
- **THEN** it keeps the newer one and no view goes back

#### Scenario: Two views in one browser
- **WHEN** Town and Board are open in one browser
- **THEN** they read one replica and show the same value for every fact

### Requirement: Every change goes through a World command

A change made in any view, the CLI, Ranger or an agent SHALL be a World command
addressed by entity ID, carrying the value the caller saw. World SHALL check the
command, record it, and then commit it to its own store or send it to the runtime on
the entity's own connection ID and runtime generation, never another connection. A
view SHALL NOT write to a runtime or a store around World. Terminal input and output
are not facts and stay on the qualified terminal relay.

#### Scenario: A rename from Board
- **WHEN** the user renames a room in Board
- **THEN** Board sends a World rename command, World sends it to that room's runtime,
  and Town, Desk, Spaces and the CLI show the new name after World observes it

#### Scenario: The runtime generation changed
- **WHEN** a command names a runtime generation that is no longer current
- **THEN** World refuses it and sends nothing

### Requirement: Observation decides World's value

For a runtime-owned fact, a command acknowledgement SHALL NOT change World's value.
World SHALL take the value from the first observation that started after the
acknowledgement. World SHALL apply an observation only if it started after the newest
observation already applied for that host and since the host's last command result,
source event or reconnection. For a World-owned fact, the store commit SHALL be the
observation.

#### Scenario: A slow read after a rename
- **WHEN** a read that started before a rename finishes after the rename was acknowledged
- **THEN** World discards that read and the old name never returns

#### Scenario: The source changes after a command
- **WHEN** someone renames the tab in the runtime after a World rename was acknowledged
- **THEN** every view ends on the runtime's newest name

### Requirement: Pending, refused and uncertain commands

Between a command and its observation, the browser that sent it SHALL show the
requested value, marked pending, in every view of that browser. A stored or observed
outcome SHALL travel in the World revision that carries its value, and the browser
SHALL keep the pending value until its replica has that revision, so the old value
never shows in between. World SHALL list
commands in progress so other clients can mark the entity as changing. A refused or
failed command SHALL show World's value again at once, with the reason where the user
acted. A command whose acknowledgement was lost SHALL be uncertain until the first
observation after reconnection decides it. A change that needs several source steps
SHALL be a durable job whose state is part of the World object, so a reload or a
service restart loses nothing.

#### Scenario: Refusal
- **WHEN** World or the runtime refuses a command
- **THEN** the pending value disappears and every view shows World's value

#### Scenario: Observed before the browser has it
- **WHEN** World observes a rename the browser asked for, and the revision carrying it
  has not yet reached that browser
- **THEN** that browser keeps showing the requested name, marked pending, and drops
  the mark when the revision arrives; it never shows the old name in between

#### Scenario: Reload during a move
- **WHEN** the browser reloads while a multi-step move is running
- **THEN** the move's state is read from the World object and the move continues or
  reports its result

### Requirement: Offline hosts

A host that stops answering SHALL be stale: its part of the World object stays visible,
marked stale and non-actionable. Commands on its runtime-owned facts SHALL be refused
and SHALL NOT be queued. Commands on World-owned facts about its entities SHALL be
accepted, and their runtime mirrors written when the host is back. On reconnection,
World SHALL observe the host before any of its commands count as settled.

#### Scenario: Rename while offline
- **WHEN** the user renames a tab on an offline host
- **THEN** World refuses with "host offline" and nothing is sent later

#### Scenario: Colour while offline
- **WHEN** the user changes the colour of an agent on an offline host
- **THEN** World stores it and every view shows it

### Requirement: History and undo

Every accepted command SHALL be a history entry with its actor, time, entity, field,
before and after values and final state, readable by the CLI and the views alike.
Undo SHALL be a new command that restores the before value and SHALL be refused when
the fact changed since. Undo SHALL cover World-owned facts and reversible runtime
facts (name, order, placement); destructive runtime changes SHALL appear in history
without undo. History SHALL NOT be trimmed automatically.

#### Scenario: Undo a Town change from the CLI
- **WHEN** the user changes an agent's colour in Town and runs `herdr-world undo` for that change
- **THEN** the colour goes back in every view and the undo is itself in history

#### Scenario: Undo after a later change
- **WHEN** the fact changed again after the change being undone
- **THEN** World refuses the undo and says to undo the later change first

### Requirement: Cross-view consistency check

Each fact moved onto the World path SHALL be covered by a test that derives one World
object and checks that Town, Desk, Board, Spaces and the CLI show the same value for
it.

#### Scenario: A view derives a moved fact again
- **WHEN** a change makes one view compute a moved fact in its own code and disagree
- **THEN** the cross-view test fails
