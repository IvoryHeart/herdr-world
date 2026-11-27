# Herdr-core runtime

## Purpose

Support herdr-core beside the Herdr TUI with qualified observation, control,
shared app state and recovery while preserving each runtime's authority.

## Requirements

### Requirement: Account-shell launch environment

Unix core agent discovery and launch SHALL enter the selected host's supported
interactive account shell, with login startup on macOS, so its tool environment
applies directly. World SHALL NOT collect and copy that environment. Unsupported
shells SHALL retain direct execution and Windows SHALL retain native launching.
Profile arguments and prompts SHALL remain literal arguments across shell entry.

#### Scenario: Tools installed by shell startup

- **WHEN** a supported account shell adds a harness or tool to its environment
- **THEN** discovery and the launched core agent can use that tool on that host,
  without exporting its environment to World or another connection

#### Scenario: Unsupported account shell

- **WHEN** the account shell cannot parse the supported exec form
- **THEN** launch uses direct execution with the same literal arguments

### Requirement: Full coexisting runtime support

World SHALL support herdr-core read-write beside the TUI runtime, select installed
core by default for new agents and unplaced plain shells, and retain a per-launch
TUI choice. Every core release SHALL receive full support without version pins or
certification gating. A newest-release smoke test SHALL flag protocol drift.

#### Scenario: Core and TUI on the same host

- **WHEN** both runtimes are available
- **THEN** World discovers both under one host; each retains its own connection
  identity and generation, new agents default to core with app placement, and
  explicitly selected TUI launches still work

#### Scenario: New release

- **WHEN** the installed core updates to a new release
- **THEN** World retains read-write support and smoke failures flag work to fix,
  without switching that release to read-only

#### Scenario: Manual or scheduled release smoke

- **WHEN** the manual or daily smoke runs
- **THEN** it resolves the newest official release, verifies its archive checksum
  and runs every live-core suite in scratch state, including native send/keys;
  failure is visible with retained release identity and test logs when available,
  without installing, pinning, falling back or changing runtime write authority

### Requirement: Existing-only qualified observation

Automatic connection and reconnection SHALL never start core. World SHALL read
the current endpoint on every attempt, including Windows SSH and a local Windows
core through a PowerShell named-pipe relay. Operations SHALL retain their exact original connection lease
and service/runtime/occupant fences at admission, dispatch and publication.

#### Scenario: Missing endpoint

- **WHEN** a core is absent, stopped or disappears during connect
- **THEN** observation is unavailable and nothing starts until a separate
  confirmed start action

#### Scenario: Install core where no runtime exists

- **WHEN** the standalone installer or Homebrew's first launch finds neither
  `hc` nor `herdr`, and `HERDR_WORLD_SKIP_HERDR` is not set
- **THEN** it installs herdr-core with its official checksum-verified steps,
  starts it now and at login and registers a local core connection; when
  either runtime exists it installs and changes nothing

#### Scenario: CLI setup with no Herdr

- **WHEN** `herdr-world herdr setup` or `herdr upgrade --install` finds no Herdr
  for a local default connection
- **THEN** an installed herdr-core is kept and no Herdr is installed beside it
  (setup also starts that core now and at login); with neither, herdr-core is
  installed and started, on Windows x64 as on Linux and macOS

#### Scenario: First run with an existing local core and no TUI

- **WHEN** World has no saved connections or explicit Herdr socket, session or
  SSH override, core is installed locally and the Herdr TUI is absent
- **THEN** World discovers core from its standard state or executable locations,
  saves only `core-local` as its default and connects using `HC_SESSION` or `default`
- **AND** discovery never starts core or alters its login item; saved defaults
  and explicit startup choices remain authoritative on subsequent starts

#### Scenario: Discovery persistence fails and startup is retried

- **WHEN** saving the discovered profile fails
- **THEN** startup reports failure rather than publishing an unsaved default;
  retry reloads persisted state first, retaining any completed save and any
  subsequently saved or explicit choice before considering discovery again

#### Scenario: Confirmed install from World

- **WHEN** a person chooses Install herdr-core for this computer or a Unix SSH
  host in Manage connections, on a core connection that found nothing running,
  or on Town's Set up card
- **THEN** World shows the version, install location, login start and any
  installed Herdr that stays, and changes nothing until the person confirms;
  after confirmation it installs (or starts an installed core) only on that
  host, shows progress and plain errors, then connects; automatic connects and
  reconnects never install or start core, and an installed runtime is never
  replaced or updated
- **AND** offered under a saved core connection, it starts that connection's
  session and connects that same connection; a connection with its own state
  directory is refused in plain words, and the install reports failure unless
  the connection ends ready

#### Scenario: Host stops programs at logout

- **WHEN** core reports `keeps_running_after_logout: false` for a local or Unix
  SSH host, at connect or on a later liveness check
- **THEN** Manage connections and the connection's status say that programs
  there stop when the last login ends and give the one fix,
  `sudo loginctl enable-linger -- <logout_linger_user>`; true, null or absent
  shows nothing, and an unsafe account name is replaced by `<user>`

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
supported by herdr-core and herdr.

#### Scenario: Core occupant fences and uncertain sends

- **WHEN** World delivers a message, answer or ask to core
- **THEN** World SHALL check the original occupant and
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
- **THEN** World refuses and types nothing until the user opens a fresh binding

#### Scenario: Saved core ask answer

- **WHEN** a verified local core asker receives a user answer
- **THEN** the durable dispatcher uses the same native send and original binding;
  a replaced occupant or retired runtime refuses while the stored answer remains
  retrievable, and an unanswered possible write stays uncertain without replay

### Requirement: Process-evidenced headless conversations

Core Chat SHALL identify Claude and Codex conversations, including `claude -p`
and fresh `codex exec`, from evidence owned by the matching live foreground
process on its captured connection's host.

#### Scenario: Foreground evidence and discovery bounds

- **WHEN** Core Chat discovers a headless conversation
- **THEN** Claude's native process record SHALL
  retain precedence. Linux writable descriptors and macOS `lsof` output MAY name a
  unique native transcript or canonical Claude session debug ID, with process
  start-time checks around the read. Discovery SHALL be bounded and read-only.
  Missing, changed, unreadable, deleted or ambiguous process evidence SHALL NOT
  establish a session. World SHALL NOT infer Claude/Codex identity from directory
  recency. Explicit launch references and reading links SHALL retain their existing
  behavior; discovery SHALL NOT grant additional input authority.

#### Scenario: Fresh headless run without a launch session ID

- **WHEN** the identified Codex or Claude foreground process holds a unique
  writable native conversation file on Linux or macOS
- **THEN** Chat and History use that conversation through the shared TUI readers
  and subsequent reads include newly appended messages

#### Scenario: Remote process evidence

- **WHEN** the agent runs on an SSH connection
- **THEN** discovery and transcript reads execute on that same host and lease,
  without falling back to this computer or another connection

#### Scenario: No unique live conversation

- **WHEN** a process has exited, changed during discovery, holds multiple
  candidate sessions, has disabled persistence or exposes no readable evidence
- **THEN** discovery supplies no session, even if newer transcripts exist nearby;
  the existing explicit-reference and unavailable behavior remains

### Requirement: Shared app state with independent World ownership

World SHALL own topology, asks/results and review receipts; it SHALL share
app placement at launch and on explicit Town moves, seen and the pin under the [M1–M11 ownership decisions](../../changes/archive/2026-11-17-herdr-core-runtime/design.md).

#### Scenario: Core placement, pins and destructive authority

- **WHEN** World shares app state or manages core terminals
- **THEN** A core tab's desk and
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
- **THEN** World patches the selected terminals' `herdr.space`, `herdr.tab`
  and `where` labels and reconciles its own topology overrides so its read
  model places them at the destination, including app-created spaces and
  World-created rooms and desks
- **AND** running terminals retain their addresses, programs and unrelated
  labels; a one-agent move leaves unselected inherited children in their
  source room, and a desk move includes every observed terminal at the desk
- **AND** moves serialize per durable core while retaining the original
  connection generation, core epoch and terminal occupants; queued moves
  reread placement and every write checks the original authority
- **AND** World-owned rooms remain when emptied and no app space is closed
  by a placement move, so the TUI's room-closing consent does not apply;
  joining a team across rooms can move the core desk to its teammate

#### Scenario: Core movement cannot complete

- **WHEN** the selected core lacks `terminal.label`, the connection is stale,
  or a source or destination has disappeared
- **THEN** Town shows the specific reason and never falls back to a TUI runtime
- **AND** if a write has been sent and a later step fails or its reply is lost,
  the outcome reports partial or unknown placement instead of success or a
  claim that nothing changed; World never retries uncertain writes or rolls
  back over another client's placement edits
- **AND** an unpinned desk reorder explains that core exposes no native desk
  ordering; pinned desks retain World's saved ordering among their room's
  pinned seats

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

### Requirement: World-started core terminals and confirmed kills

World SHALL start agents in core with an absolute host executable, no caller,
no parent, no notes and an explicit keep, placed in the apps by `herdr.space`,
`herdr.tab`, a `where` caption and an unseen `herdr.seen`; plain shells SHALL
start unplaced and not kept.

#### Scenario: Core launch placement and confirmed teardown

- **WHEN** World starts or ends core terminals
- **THEN** World's rooms, their order and the tabs it started
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
names.

#### Scenario: Core project resources and native delivery

- **WHEN** World serves resources or acts for a core agent
- **THEN** An agent's worktree selection SHALL be bound to the program occupying
  its address. A core room MAY be a Git worktree World created or opened; its
  checkout is the room's folder. Any other World-created room MAY keep a
  folder World checked on the core's host when creating it; its terminals SHALL
  start there. Removing a worktree room SHALL ask to confirm every
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
popups and use the fixed PowerShell named-pipe/key transport for Windows connections.

#### Scenario: Observer alone

- **WHEN** a phone observes a terminal with no interactive viewer
- **THEN** it renders the grid core reports: core 0.1.21 and later keep the
  terminal's size (an observer never sizes it, upstream #199); an older core may
  move it to headless on attach, and World reports that move, never hides it

#### Scenario: One Inspector for a core agent

- **WHEN** the user opens a live core agent from Town, Board, Desk, Needs you,
  Open chat, the agent menu or a phone's switch list
- **THEN** it opens in the same Inspector window as a Herdr agent, with Chat,
  Terminal, Files and Changes tabs; Open chat selects Chat, and the Terminal
  tab is the core watch, not a separate window

#### Scenario: World holds a readable size while open

- **WHEN** a core terminal's Terminal tab is open and no Herdr app pane holds
  its size
- **THEN** core sizes it to the tab's fitted grid and keeps it there through
  blur and idle; resizing the window resizes the terminal without a headless
  step; another tab of the same window keeps the size, and closing or
  minimizing the window ends the watch and gives the size back to core's rule

#### Scenario: An app pane keeps its size

- **WHEN** a Herdr app pane holds the terminal's size while World shows it
- **THEN** World never resizes it, draws its grid at a readable scale and
  scrolls what does not fit; a key typed in World leads by core's own rule and
  a key or click on the app's pane retakes it

#### Scenario: First key

- **WHEN** the user clicks the Terminal tab or presses a key while it is shown
- **THEN** the terminal takes focus and shows its cursor, and the key is sent
  exactly once, after World's watch has opened if it is still opening; a
  terminal reply goes only on a seat a person typed into

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
registry, detection manifest, desktop program list and World's profiles.

#### Scenario: Core harness status and brief delivery

- **WHEN** World launches, observes or sends a brief to a core harness
- **THEN** World
  SHALL read status from core records checked against the process, without
  running TUI screen inference or status-writing integrations for core: an
  interactive agent without a report SHALL be unknown, never working; a live
  headless invocation (`claude -p`, `codex exec` and the like) SHALL be working
  unless it reports blocked; and a known harness's working or blocked report
  SHALL be stale, read idle, once no harness runs in the terminal's foreground.
  A report SHALL speak only for the harness running: one naming another
  harness, or left unchanged by a process World saw exit, SHALL count as no
  report. A harness World saw inside a wrapper SHALL stay the desk's agent,
  idle, after it exits while that wrapper leads the terminal; that departed
  harness, never an earlier reporter, SHALL name the desk. World SHALL count a
  process as exited only on evidence: a foreground group the host could not read
  SHALL keep what World last saw running there, harness and headless alike, as
  the desk's process evidence ahead of any report. An option's value SHALL never mark an
  invocation headless.
  World SHALL find a desk's agent as Herdr's TUI does: the foreground group's
  leader, else, where the host can read it (a core on this Linux machine), the
  nearest group member that is a harness; a shell or interpreter leading the
  group whose members World cannot read SHALL keep its report.
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

### Requirement: Distinguishable unnamed app spaces

World SHALL name an app-created core space that has no name in its `where`
captions for display only, once, from the space's oldest terminal that shows
anything: its folder, else its tab, else its agent.

#### Scenario: Unnamed space display continuity

- **WHEN** World names an unnamed app-created core space
- **THEN** World SHALL keep that name
  while the space lasts, so agents coming and going, in that room or another,
  never change it. The row SHALL say the name is derived and views SHALL mark it.
  A derived name another room of the same core already shows SHALL get a number,
  kept when other rooms leave. World SHALL NOT write the derived name to core and
  SHALL NOT change the space's owner.

#### Scenario: Unnamed app space

- **WHEN** an app-created core space has no name in its `where` captions
- **THEN** its room reads a name derived from its oldest terminal's folder,
  tab or agent, marked as derived, and the name stays as agents come and go
- **AND** with no evidence the room reads `Herdr space`

#### Scenario: Two rooms derive the same name

- **WHEN** two unnamed spaces of one core derive the same name
- **THEN** the later reads with a number (`api`, `api 2`), and keeps it when
  the other room leaves

#### Scenario: World launches into an unnamed space

- **WHEN** World starts an agent in an unnamed app space
- **THEN** its `where` caption says `Herdr space / <tab>` with World's
  placeholder label, never the derived name, while the app's own
  `Herdr space` caption stays a name

## Known limits

See World's [runtime support table and limits](../../../FEATURES.md#runtime-support)
for the user-facing contract. Windows local core and Windows SSH remain
untested on real hardware. Fake-host and PowerShell-on-Linux checks do not
establish native ACL, named-pipe or key behavior.

Unreleased core changes after 0.1.21 wait for the next core release. This does
not pin supported versions or gate read-write support; the newest-release
smoke flags drift. Historical acceptance evidence stays in the archived
[handover](../../changes/archive/2026-11-17-herdr-core-runtime/delivery.md).

### Upstream questions Q1–Q11

These record the protocol and interoperability boundaries at archival, including
Q4's answer. They do not change the requirements or authorize a World workaround
that duplicates core's responsibilities.

1. **Q1 — Compatibility:** release semantic-change notes and a deprecation
   policy remain an upstream question (#115); new releases receive full
   support without certification.
2. **Q2 — Existing-only connect:** a no-autostart connect/status API remains an
   upstream question (#203/#209). World uses its existing-only endpoint
   transports, including the fixed Windows PowerShell relay.
3. **Q3 — Safe input:** core has no execution-time program-incarnation
   condition for queued send/keys. World checks occupant and foreground
   immediately before dispatch, but queued input can still reach a kept
   replacement shell. Cancellation cannot revoke input already typed or
   close the event-delivery interval; possible writes stay uncertain without
   automatic retry or per-harness side channels.
4. **Q4 — Observer resize, answered:** core 0.1.21 (#199) keeps the terminal's
   size when an observer attaches or leaves. Only typing viewers size it.
   World still reports older cores' headless move; the 0.1.20 recordings remain
   historical evidence.
5. **Q5 — Oversized recovery:** explicit suppressed-missed notifications,
   label caps or snapshot pagination remain upstream questions. World's
   ordered-mirror gap and recovery rules remain required.
6. **Q6 — Status coverage:** complete core status for every harness, including
   non-reporting agents (#826), remains an upstream question. Missing status
   stays unknown; World never injects status. Core 0.1.21 reports only the
   foreground group's leader: World reads the other members on the host for a
   local Linux core, and asks core to report them so remote and macOS cores
   see agents run by wrappers.
7. **Q7 — Labels:** core has no compare-and-set or numeric-max seen update.
   An unseen concurrent write, or unread returning a label to the value World
   decided on, can be overwritten despite World's best-effort seen fences.
8. **Q8 — Placement:** app space/tab-name labels (app #43) and phone Inbox
   placement remain upstream questions. An
   unplaced World shell can appear under app Spaces, rather than Inbox; World and app
   layouts retain independent ownership.
9. **Q9 — Environment:** stripping inherited `HERDR_*` markers from other
   runtimes remains an upstream question. Markers alone grant no World caller
   authority.
10. **Q10 — TUI evolution:** the TUI-on-core timeline and import path (app #63)
    remain upstream questions; the two providers continue to coexist.
11. **Q11 — Conditional kill:** core cannot condition a kill on the exact
    confirmed cascade. A child created after World's last applied event, or
    during the killed program's exit (up to about three seconds), may end
    unconfirmed. World refuses observed confirmation changes and names any
    unconfirmed terminals in the outcome; only core can close the remaining
    race.
