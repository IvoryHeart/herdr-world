# World identity

## Purpose

Give World-owned records store-issued identity independent of source IDs and
runtime fences. The current implementation covers the SQLite identity allocator and
verified source bindings; claims and remaining JSON-family ID creation remain
in the active `world-protocol-identity` change.

## Requirements

### Requirement: World IDs

WorldStorage SHALL provide a shared asynchronous ID allocator for new World-owned
records in `world.sqlite`. Each new ID SHALL contain a lowercase kind prefix and
eight random base32 symbols. The store SHALL check existing reservations and
reserve the ID durably before returning it. IDs SHALL NOT derive from counters,
clocks, source native IDs, labels, paths or runtime fences.

Existing SQLite IDs and record IDs imported from the ledger JSON store SHALL
remain unchanged and SHALL be reserved against new allocation. Allocation SHALL
check all registered families, regardless of a legacy ID's prefix. Reservations
SHALL survive record deletion, history retention and restart. A restored stopped
backup SHALL resume with fresh entropy and its saved registry, rather than a
rolled-back sequence. Closing storage SHALL refuse new allocation and drain
admitted allocations before releasing the worker.

#### Scenario: Imported IDs collide with new candidates
- **WHEN** a random candidate equals an existing imported ID, including one in a
  different record family
- **THEN** the store retries without changing the imported record's ID

#### Scenario: An old record is trimmed
- **WHEN** retention removes a SQLite record and its replay history
- **THEN** its ID remains reserved and cannot be allocated to another record

#### Scenario: Restore a stopped backup
- **WHEN** World opens an earlier stopped copy of its database
- **THEN** new IDs use fresh randomness and exclude that copy's reserved IDs

#### Scenario: Acknowledgement is lost
- **WHEN** ID reservation commits but the caller never receives the reply
- **THEN** reopening the store retains that reservation and never reissues it


### Requirement: Verified source bindings

A World record that claims identity with a source entity SHALL refer to it only through
a binding that names:
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
  from the topology. A string bound to a workspace or tab that held no terminals keeps
  its weak evidence: it is attached while the target exists, and never authorizes
  Send.
- **Terminal appearance:** stays with its record while any witnessed terminal is
  present, including after a lost move acknowledgement. It is reclaimed only when a
  current, complete listing shows every witnessed terminal absent.
- **Tab colour:** follows appearance, and is also dropped on an observed tab close.
- **Agent interest:** follows its terminal and is dropped only by a complete pane
  listing of the current runtime that omits it.

**Layout preferences are not bindings.** This covers Board card positions, pins and
folds, and the workspace and host colours saved under card keys. They claim no
identity. Each SHALL:
- key on the connection profile and native ID only;
- carry no continuity evidence;
- be inherited when a native ID is reused.

Tab colours stay terminal appearance, under the Terminal colour requirement.

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

#### Scenario: A workspace ID is reused
- **WHEN** Herdr restarts and a new workspace reuses a workspace ID that had a Board card
  position and a workspace colour
- **THEN** the new workspace inherits that position and colour, as today.
  - A Board string witnessed by the old workspace's terminals becomes unconfirmed, not
    attached.
  - A string bound while the workspace held no terminals keeps today's weak-evidence
    rule, and stays attached while the workspace exists

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
extend a record's lifetime. The owner-approved terminal-mark persistence changes
Desk marks/recent opens, watchlist and completion seen to the following lifetimes:

- Watchlist follows its witnessed terminal on its original source, including a
  uniquely observed terminal move. Complete current absence clears it.
- Desk metadata and completion seen also require a captured session when known;
  explicit unknown session binds to terminal. Complete current terminal absence
  or a positive different known session clears them. Missing session evidence
  remains unresolved or unconfirmed and never silently retargets a saved mark.
- Offline, partial, stale and duplicate observations preserve saved records but
  attach nothing. Restart and runtime replacement hide the qualified projection
  until a new complete unambiguous observation verifies the same evidence.
- Fresh working/blocked evidence ends completion seen. Later native progress
  ends a checked completion even if World missed the intervening work; older
  progress cannot erase a newer check. Desk retains its exact-stop Undo,
  bounded recency and stop-display expiry rules.
- An explicit user mark may replace an unresolved capture for that terminal;
  the old record is cleared, never inherited by the new identity.

#### Scenario: Watchlist after a restart
- **WHEN** World restarts and then verifies the original terminal in a complete,
  current, unambiguous observation of its original source
- **THEN** its saved watch reappears with the same World ID and a fresh runtime
  projection; before verification it remains unresolved

#### Scenario: A bound tab closes
- **WHEN** a tab bound to a Board string is closed on the current runtime
- **THEN** the string follows its declared lifetime and moves to "Needs a home"
