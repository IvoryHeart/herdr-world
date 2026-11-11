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

Messages, answers and asks SHALL use core's own send/keys for every harness
supported by herdr-core and herdr. World SHALL check the original occupant and
its foreground immediately before each send/keys dispatch on the captured lease
and SHALL NOT build per-harness side channels. Kept replacement, changed
session/foreground evidence and retired leases SHALL invalidate World dispatch
authority even when address, pid or labels survive. A timeout SHALL be shown as
"uncertain"; unanswered possible writes SHALL NOT retry automatically. Closing
the queued-send replacement window belongs to core (Q3), not World's pre-send check.

#### Scenario: Every supported harness

- **WHEN** a user sends a message, answer or ask to any supported harness,
  including Pi, OpenCode or Gemini
- **THEN** World checks occupant and foreground immediately before using core
  send/keys, without requiring a Claude/Codex-specific delivery channel

#### Scenario: Replacement before dispatch

- **WHEN** the original occupant or foreground changes before World dispatches
- **THEN** World refuses the send until fresh evidence verifies its recipient

#### Scenario: Replacement after enqueue

- **WHEN** a message waits in core's queue and the agent becomes a kept shell
- **THEN** execution-time recipient fencing is core's Q3 obligation; World's
  pre-send check alone provides no guarantee against this race, including after
  disconnect, and World does not substitute a harness side channel

#### Scenario: Send timeout

- **WHEN** core does not answer a send before its deadline
- **THEN** World shows "uncertain", retains the original recipient and never
  automatically retries the possible write

#### Scenario: Foreground evidence is unavailable

- **WHEN** the foreground was missing at binding or is missing or different
  before dispatch, including an agent that exited into its wrapping shell
- **THEN** World refuses and types nothing until the owner opens a fresh binding

#### Scenario: Saved core ask answer

- **WHEN** a verified local core asker receives an owner answer
- **THEN** the durable dispatcher uses the same native send and original binding;
  a replaced occupant or retired runtime refuses while the stored answer remains
  retrievable, and an unanswered possible write stays uncertain without replay

### Requirement: Shared app state with independent World ownership

World SHALL own topology, asks/results, review receipts and card pins; it SHALL
share app placement at launch, seen and favourite under M1–M11. World SHALL read
agent status from core and SHALL NOT write it, including for integrations World
installed. Native destructive actions SHALL confirm all dying descendants.

#### Scenario: Review a finished turn

- **WHEN** a finished turn becomes visibly seen in foreground World
- **THEN** shared seen clears done in the apps while blocked/error precedence,
  missing-seen semantics and explicit unread remain respected

#### Scenario: Unread elsewhere while World looks

- **WHEN** another Herdr client marks a turn unread while a World page still
  shows the agent, or changes `herdr.seen` after World decided to write
- **THEN** World keeps it unread until a new turn or a new look and writes no
  label other than the one its look was decided on

#### Scenario: Favourite and push

- **WHEN** a person stars a core agent in World or pins it in a Herdr app
- **THEN** `herdr.pinned` changes and every client shows it, while desk and
  card pins and review receipts stay World-only; a core agent that finishes
  after working or starts needing World's owner pushes from core status
  events under Herdr's attention rule

#### Scenario: Missing agent status

- **WHEN** a harness has no reported status or its reporting times out, including
  a harness whose integration World installed
- **THEN** World leaves status unknown and never injects or writes status to core

### Requirement: World-started core terminals and confirmed kills

World SHALL start agents in core with an absolute host executable, no caller,
no parent, no notes and an explicit keep, placed in the apps by `herdr.space`,
`herdr.tab`, a `where` caption and an unseen `herdr.seen`; plain shells SHALL
start unplaced and not kept. World's rooms, their order and the tabs it started
SHALL live in World's SQLite under the durable core ID. Before any native kill,
room close or bin close, World SHALL name every terminal core will end with it,
bind each to the program it saw (core, address, pid and argv) and send the kill
only while its current observation ends no more than that confirmed set.

#### Scenario: Agent launch

- **WHEN** a profile starts on a host with a connected core
- **THEN** core receives exactly those parameters, the desktop app shows the agent
  in its space with World's names, and World shows it in World's room

#### Scenario: A child appears after the confirmation

- **WHEN** a die-with-parent child that World has observed was not in the
  confirmation, or a confirmed program was replaced (even reusing its pid)
- **THEN** World sends no kill, shows the new plan and asks again

#### Scenario: A child core creates after World's last observation

- **WHEN** core creates a child between World's last applied event and the kill
- **THEN** core's cascade may end it; core has no conditional kill (Q11)
- **AND** World's kill outcome names every unconfirmed terminal that ended or
  is ending in that cascade, never one that had ended before the kill

### Requirement: Host resources, asks and Ranger for core agents

World SHALL serve a core connection's Files, Changes, Git actions, file
transfers and an agent's worktree from World's read model of that core and
World's own guarded host helpers on the core's host, never from core's
`file.*`, and only under the connection and runtime generation the request
names. An agent's worktree selection SHALL be bound to the program occupying
its address. A core room MAY be a Git worktree World created or opened; its
checkout is the room's folder. Removing it SHALL ask to confirm every
terminal that ends with it, run the teardown hook only while that
confirmation holds, end the confirmed terminals, and only then remove the
checkout under the same generation. A `herdr-world` command inside a core
terminal SHALL be a verified caller only when that terminal's program is an
ancestor of the calling process; its ask SHALL be bound to that program.
World SHALL deliver saved core ask answers and confirmed Ranger prompts
through core's native send, with a fresh program/foreground check before
submission. Lost replies SHALL remain uncertain and SHALL NOT automatically
replay. Ranger SHALL read core rooms (screen only, never a scrolling read);
core lifecycle controls SHALL remain in World's dedicated controls.

#### Scenario: Two cores with the same address

- **WHEN** two core connections both have `t1` and a request names one
- **THEN** only that connection's host runtime answers, under its generation

#### Scenario: Worktree removal after a new child

- **WHEN** a child that would end with the room's terminal appears after the
  confirmation
- **THEN** no hook runs, nothing ends, nothing is removed and World shows the
  new list

#### Scenario: Replaced asker

- **WHEN** the program that asked is replaced at the same address, even with
  the same pid
- **THEN** World does not treat the new program as the asker, including a
  restart event with identical native fields; a retired connection generation
  cannot restore automatic answer input or acknowledge as that original asker

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

#### Scenario: Room shell on either runtime

- **WHEN** the user opens an agent's room shell (Herdr Float, the one TUI plugin
  popup World invokes)
- **THEN** a TUI agent toggles the Herdr Float plugin in its own Space and
  folder through the same qualified plugin action as the shortcut, and a core
  agent gets World's float shell: core runs that machine's shell unplaced,
  without parent or notes, named for the room and labelled `world.float`, in the
  agent's current folder; it never becomes a desk

#### Scenario: One room shell, shared and kept

- **WHEN** two browsers open the same room's shell at once, or one hides it
- **THEN** core's live-name uniqueness keeps one shell that both join; hiding
  leaves it running at core's headless size once no view remains; every view
  closes when it exits or is ended

#### Scenario: Room shell authority

- **WHEN** a terminal World did not label for that room holds the name, the
  shell's own programs change its foreground, core restarts, or ordering is lost
- **THEN** World never attaches to or ends the foreign terminal; a foreground
  change in the shell keeps its view and End shell (only the program occupant
  is bound); the stream's lease, connection generation and core process are
  checked at dispatch and publication, so a restarted core closes the view
  with its reason and never resumes it on the new process; Open again takes
  the connection's current generation and the service refuses it when the
  agent's address now belongs to another room
- **AND** a browser whose socket closes while its view opens gets none: an
  attachment that arrives after the browser left is detached at once, and a
  browser that sees its own socket drop closes the view with Open again

#### Scenario: Room shell ordering and flow

- **WHEN** core's first paint arrives before the browser has the open reply, or
  a browser falls behind the stream
- **THEN** the paint is held until the reply naming the stream is sent, and
  World returns core's stream window only as the browser drains, so a slow
  browser holds core's stream instead of World buffering it

### Requirement: Every supported harness and shared transcript readers

World SHALL offer a core launch kind for every harness in Herdr's integration
registry, detection manifest, desktop program list and World's profiles. World
SHALL read status only from core records, showing unknown without a report,
without running TUI screen inference or status-writing integrations for core.
Generic profile briefs SHALL use the same native delivery path as Chat after
core has observed the original program's foreground, with native `if: "idle"`
so core checks readiness after its queue/startup/draft waits, before typing.
Unknown, blocked or other non-idle status SHALL NOT receive an automatic brief.
Startup timeout or native refusal SHALL leave the program running with an
explicit unsent-brief notice. Uncertain brief delivery SHALL retain the started
terminal's identity and distinguish it from an uncertain launch.

#### Scenario: Unreported startup trust prompt

- **WHEN** a generic harness opens a folder-trust dialog without reporting status
- **THEN** core refuses the automatic brief without pasting text or Enter;
  World reports it started and offers Chat for explicit delivery

#### Scenario: Readiness changes during a queued brief

- **WHEN** core holds a brief for startup or a person's unfinished draft and
  the status becomes unknown, blocked or working
- **THEN** core's idle condition refuses it before any text or Enter is typed

#### Scenario: Harness with a different executable name

- **WHEN** a profile names Cursor, Antigravity or Kiro
- **THEN** World resolves cursor-agent, agy or kiro-cli on that host before launch

#### Scenario: Reading a core conversation

- **WHEN** a supported TUI transcript reader can resolve a native session or an
  explicit reading link on the core host
- **THEN** core Chat uses that same reader, checks the original lease, occupant
  and foreground before and after reading, and discards a changed title or session

#### Scenario: Transcript unavailable or linked only for reading

- **WHEN** the harness/platform has no reader or a link selects another transcript
- **THEN** World explains the reading limitation and retains native send/keys
  bound to the originally opened recipient; transcript evidence grants no input
  authority and never changes core status
