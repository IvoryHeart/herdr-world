## Purpose

Give World-owned records stable identity that survives World and Herdr restarts. Bind
records to source entities only by evidence that each record kind declares, keep
runtime fences apart from identity, and let several sources make claims about one field.

## ADDED Requirements

### Requirement: World IDs

Every World-owned record SHALL have a World ID that is unique within its instance's
data folder. A record imported from an earlier World store SHALL keep its existing ID
as its World ID. Every new World ID SHALL be:
- short;
- issued by the instance's store;
- checked against existing IDs before use.

A new World ID SHALL NOT come from a counter or clock that restoring a backup could roll
back, so a restored data folder does not reissue IDs. A new World ID SHALL NOT be
derived from a source's native ID, a label, a path or a runtime generation. No World ID
SHALL change when World, Herdr or a connection restarts.

#### Scenario: Herdr reuses a workspace ID
- **WHEN** Herdr restarts and a new workspace reuses the ID of one a World note
  described
- **THEN** the note keeps its own World ID and is not merged with any record for the
  new workspace

#### Scenario: Import from the JSON store
- **WHEN** World moves records from a JSON store into its database
- **THEN** each record keeps its existing ID and new records receive IDs that collide
  with none of them

#### Scenario: Restored backup
- **WHEN** the owner restores a stopped World's data folder from an earlier copy and
  World then creates new records
- **THEN** the new records do not receive IDs that the restored copy's later records
  had been given

### Requirement: Verified source bindings

A World record SHALL refer to a source entity only through a binding that names:
- the adapter;
- the source instance, which for Herdr is the connection ID;
- the entity kind;
- the native ID;
- the continuity evidence for that kind.

**Per-kind declarations.** Each record kind SHALL declare its evidence, the continuity
paths it accepts, its absence rule and its lifetime. No general rule SHALL override a
kind's declaration.

**Continuity paths.** The only ways a binding moves to another native ID SHALL be:
- a witnessed terminal ID appearing under a new native ID in a current, complete
  listing of the same runtime;
- the result of a move World itself performed, naming the new native ID for the
  witnessed terminal;
- explicit user action.

Source events, labels, working directories, agent kinds, reused pane IDs and runtime
generations SHALL NOT prove continuity.

**Absence.** The only authoritative absences SHALL be:
- a close observed on the current runtime generation for the bound target;
- a qualified not-found on the current runtime generation;
- a current, complete listing in which every witnessed terminal is absent.

**States.** A binding SHALL be in one of four states:
- **attached:** a current, complete observation shows the native ID exactly once with
  matching evidence;
- **unresolved:** the source is offline, stale, filtered or partially listed; the
  record has not been observed since World started; or the native ID, terminal or
  session appears more than once in one current observation;
- **unconfirmed:** the native ID is present in a current observation, but the evidence
  does not match;
- **ended:** an absence the kind declares has occurred, while the binding still names
  the checked target.

Rules for each state:
- Only attached bindings SHALL authorize actions, and only through a freshly qualified
  target.
- An unresolved binding SHALL keep its saved native ID and evidence unchanged.
- An unconfirmed binding SHALL become attached only by explicit user action or a rule
  its record kind declares.
- A record whose agent session is the explicit unknown identity SHALL bind to its
  terminal.

**Existing kinds keep their current rules:**
- **Board strings:** follow only moves World performs. They end only on an observed
  close or a qualified not-found, and stay unresolved while their target is missing
  from the topology.
- **Terminal appearance:** stays with its record while any witnessed terminal is
  present, including after a lost move acknowledgement. It is reclaimed only when a
  current, complete listing shows every witnessed terminal absent.
- **Tab colour:** follows appearance, and is also dropped on an observed tab close.
- **Agent interest:** follows its terminal and is dropped only by a complete pane
  listing of the current runtime that omits it.

#### Scenario: Host offline
- **WHEN** a bound entity's host is offline or its listing is partial
- **THEN** the binding is unresolved, keeps its saved target, authorizes nothing and is
  not ended

#### Scenario: Herdr restart reuses pane IDs
- **WHEN** Herdr restarts and restores a pane with the same pane ID but a new terminal
- **THEN** a binding evidenced by the old terminal becomes unconfirmed, not attached

#### Scenario: World restarts while Herdr keeps running
- **WHEN** World restarts and then observes the same terminals as before
- **THEN** bindings evidenced by those terminals become attached again without asking
  the user

#### Scenario: Move performed by World
- **WHEN** World moves a pane, and the move result names its new pane ID for the
  witnessed terminal
- **THEN** a Board string and an appearance record bound to that pane follow it and
  stay attached

#### Scenario: Move reply lost
- **WHEN** World moves a coloured pane, the move reply is lost, and a later complete
  listing of the same runtime shows the witnessed terminal under a new pane ID
- **THEN** the appearance record and its colour follow the terminal, and nothing is
  reclaimed

#### Scenario: Pane moved outside World
- **WHEN** a pane with a Board string is moved in Herdr's own interface
- **THEN** the string stays unresolved until a qualified not-found or an observed close,
  as today, and is never ended by the old pane ID's absence alone

#### Scenario: Duplicate native identity
- **WHEN** one current observation shows the same session or terminal in two panes
- **THEN** the binding stays unresolved, authorizes nothing and is not ended

#### Scenario: Look-alike entity
- **WHEN** a new pane has the same label, directory and agent kind as an ended one
- **THEN** no ended or unconfirmed binding attaches to it without the user

### Requirement: Fences are not identity

A durable record SHALL NOT store any of these as its identity:
- a runtime generation;
- a transport, observation or subscription epoch;
- a service incarnation.

Work that captured such fences SHALL recheck them before it acts. Work persisted by
one service incarnation SHALL re-resolve its bindings to fresh qualified targets in the
next incarnation before it acts.

#### Scenario: Persisted work after a service restart
- **WHEN** work captured a host's runtime generation and World restarts before
  dispatching it
- **THEN** the work re-resolves its binding to the current runtime and dispatches only
  if the binding is attached and its other checks pass

### Requirement: Per-field claims

A field that more than one source can report SHALL carry claims. Each claim SHALL
record:
- the value;
- the source that delivered it, and its author when known and different;
- when it was observed;
- whether it was reported or inferred;
- the source's revision, when the source has one.

Several claims SHALL coexist for one field.
- Each field SHALL declare the rule that chooses what to display.
- A claim SHALL be removed only by its own source's complete listing or an explicit
  retraction. Another source's silence SHALL NOT remove it.
- A verb SHALL declare which claims authorize it, rather than using the most recent
  claim.
- A harness's native session or thread ID SHALL be a claim about the agent, never
  World's identity for it.

#### Scenario: Two sources disagree
- **WHEN** Herdr reports an agent idle and World infers it working from its transcript
- **THEN** both claims are kept with their sources, and the field's display rule
  chooses what is shown

#### Scenario: One source goes quiet
- **WHEN** one source stops reporting a field that another source still reports
- **THEN** the other source's claim remains, and the silent source's claim is removed
  only by its own complete listing or retraction

#### Scenario: Authority for a send
- **WHEN** a send needs the agent session in a pane
- **THEN** only the pane's current reported session authorizes it, not an inferred or
  older claim

### Requirement: Explicit record lifetimes

Each kind of World record SHALL declare what happens when its binding ends: archive,
clear, keep unresolved, or move to "Needs a home". Durable identity alone SHALL NOT
extend a record's lifetime. Records whose current contract clears them on restart or
runtime replacement SHALL keep that contract until it is changed by its own approved
requirement. This includes the watchlist, Desk marks and completion "seen".

#### Scenario: Watchlist after a restart
- **WHEN** World restarts after this change while its watchlist contract is unchanged
- **THEN** the watchlist is empty, as before, even though durable bindings exist

#### Scenario: A bound tab closes
- **WHEN** a tab bound to a Board string is closed on the current runtime
- **THEN** the string follows its declared lifetime and moves to "Needs a home"
