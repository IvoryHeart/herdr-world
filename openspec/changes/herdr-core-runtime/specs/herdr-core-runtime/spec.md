## ADDED Requirements

### Requirement: Full coexisting runtime support

World SHALL support herdr-core read-write beside the TUI runtime, select installed
core by default for new agents and unplaced plain shells, and retain a per-launch
TUI choice. Every core release SHALL receive full support without version pins or
certification gating. A newest-release smoke test SHALL flag protocol drift.

#### Scenario: Core and TUI on the same host

- **WHEN** both runtimes are available
- **THEN** each retains its own identity and generation, new agents default to
  core with app placement, and explicitly selected TUI launches still work

#### Scenario: New release

- **WHEN** the installed core updates to a new release
- **THEN** World retains read-write support and smoke failures flag work to fix,
  without switching that release to read-only

### Requirement: Existing-only qualified observation

Automatic connection and reconnection SHALL never start core. World SHALL read
the current endpoint on every attempt, including Windows SSH through a PowerShell
named-pipe relay. Operations SHALL retain their exact original connection lease
and service/runtime/occupant fences at admission, dispatch and publication.

#### Scenario: Missing endpoint

- **WHEN** a core is absent, stopped or disappears during connect
- **THEN** observation is unavailable and nothing starts until a separate
  confirmed start action

#### Scenario: Same core through another profile

- **WHEN** profile A's delayed operation outlives its lease and profile B reaches
  the same core ID and terminal address
- **THEN** the delayed operation neither dispatches nor publishes through B

### Requirement: Ordered mirror and recovery

World SHALL acquire an atomic baseline and apply unfiltered deltas in order.
Missed snapshots SHALL replace state and discard callbacks at or below their cut.
Unexplained event gaps or heartbeat jumps SHALL retire actionability and trigger
fresh acquisition; heartbeat SHALL NOT advance the event cursor. Restart SHALL
reset sequence interpretation while preserving durable terminal identity.

#### Scenario: Independent deltas and stale callback

- **WHEN** two terminal facts change and a missed snapshot precedes an old callback
- **THEN** both facts match the snapshot cut and the callback cannot roll it back

#### Scenario: Suppressed missed snapshot

- **WHEN** no missed notification arrives and heartbeat exceeds the applied cursor
- **THEN** the host becomes non-actionable until fresh acquisition succeeds

#### Scenario: Core restart

- **WHEN** the same core restarts with holders retaining terminals and seq resetting
- **THEN** reconnect accepts the new baseline even below the old cursor, while old
  continuations retain no authority and unanswered writes are not replayed

### Requirement: Occupant-bound session delivery

Chat, answers and asks to Claude and Codex SHALL use their own trusted harness
session channels, conditioned on the original recipient at the input boundary.
Kept replacement, changed session/foreground evidence and retired runtime leases
SHALL invalidate authority even when address, pid or labels survive. Possible
writes without answers SHALL remain uncertain and SHALL NOT retry automatically.

#### Scenario: Replacement after enqueue

- **WHEN** a message waits at the source and the agent becomes a kept shell
- **THEN** the original session gate refuses delivery to that shell, including
  after disconnect, without terminal-typing fallback

### Requirement: Shared app state with independent World ownership

World SHALL own topology, asks/results, review receipts and card pins; it SHALL
share app placement at launch, seen and favourite under M1–M11. World SHALL write
status only for its installed harness integration when the agent does not report
its own status. Native destructive actions SHALL confirm all dying descendants.

#### Scenario: Review a finished turn

- **WHEN** a finished turn becomes visibly seen in foreground World
- **THEN** shared seen clears done in the apps while blocked/error precedence,
  missing-seen semantics and explicit unread remain respected

#### Scenario: Self-reporting agent

- **WHEN** a harness reports its own status
- **THEN** World does not inject status, even after a reporting timeout

### Requirement: Observe and control with app coexistence

Observe streams SHALL be independent per browser, negotiate resize notifications,
and apply authoritative RESIZE before DATA/paint without emitting human input,
FOCUS or RESIZE. Interactive control SHALL begin with the first genuine key,
delivered exactly once after attach. World SHALL provide equivalents for TUI-only
popups and verify Windows named-pipe/key behavior on a real owner test host.

#### Scenario: Observer alone

- **WHEN** a phone observes a terminal with no interactive viewer
- **THEN** it renders the core's headless grid, including the documented attach
  resize exception

#### Scenario: First key and desktop reclaim

- **WHEN** the user types in focused World and later clicks the desktop app pane
- **THEN** World sends the first key once and takes the interactive size, then the
  desktop app can reclaim its own size
