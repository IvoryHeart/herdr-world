## Architecture

### 1. Provider seam

Extend `AdapterDefinition` with only the small interfaces both providers need:
terminal streams, session producers and host-resource resolution. Retain typed
dispatch, invalidate-only watch, epoch/lifetime/evidence and descriptor budgets.
Move the existing direct TUI calls behind typed verbs; keep TUI behavior intact.
The core mirror belongs inside its provider. Do not invent TUI RPC names, another
framework, a split engine or a core document for World state.

### 2. Existing-only connections

Automatic local and SSH connects/reconnects never start core. Read `core.lock`
on every attempt and connect directly to its recorded endpoint. A Unix SSH
connection reads the lock through SSH and rebuilds its stream-local forward when
the path changes. A stale lock or disappearing socket means unavailable.
Check socket-directory ownership and private mode (0700 on Unix), otherwise refuse.

Windows SSH uses a fixed PowerShell named-pipe relay with no CLI autostart path.
A probe reads `core.lock` (past the mandatory lock core holds on its first byte)
and the relay opens exactly that existing pipe at identification level; a pipe
owned by or granted to anyone but the user, SYSTEM or Administrators is refused,
the Windows form of the Unix 0700 check.
Verify pipe discovery, EOF, cleanup, reconnect and win32-input-mode on real Windows
with the owner. It is an implementation obligation, not an upstream-blocked scope
exception. Do not call `hc connect`, `server status` or other CLI probes. EOF may
retry automatically through these existing-only transports. Starting a stopped
core is a separate confirmed action that describes environment/startup effects.

### 3. Identity, ownership and occupants

Durable identity is `(core.id, tN)`; a changed `core.id` marks bindings replaced.
Never use a terminal name or OS `login_session` as agent identity.
Each operation captures immutable connection ID, the exact `ReadyRuntimeLease`,
the source fence `{adapter, instance, service_incarnation, generation}` and session
evidence. Recheck the original lease at admission, dispatch, publication and every
follow-up effect. Never reacquire a replacement lease by core ID or terminal
address, or deliver profile A's delayed work through profile B on the same core.
World service restart cannot revive an old continuation.

An occupant binds `(core.id, tN, pid)`, verified session evidence and the harness's
foreground `{pid, name}`. Retire it on `restarted`, changed pid/argv/template in a
snapshot, `reported` becoming false, or a verified in-shell session change. At
every session dispatch compare current foreground with the recorded harness;
suspend authority until fresh evidence if it differs. This includes disconnected
replacement, reused pids and never-reporting shell-wrapped agents. Surviving
labels, unchanged addresses and readiness are insufficient proof.

### 4. Mirror and recovery

Subscribe unfiltered, credit every consumed channel, and assemble lines from
bytes with per-channel streaming UTF-8 decoders. Events are deltas on independent
terminal facts, not complete replacements. Apply created/removed and field events
in sequence. `missed` replaces the entire state at the snapshot cut; discard
events at or below that cut, including old callbacks delivered afterwards.
Accept a baseline atomically as a postcondition, even if a restarted process has
a smaller sequence. Reconnect resets the cursor and acquires a fresh baseline.
Keep core epoch distinct from World runtime generation and service incarnation.

An unexplained event gap retires actionability and resubscribes. A heartbeat above
the last applied sequence also makes the host non-actionable and acquires afresh;
heartbeats never advance the cursor. A bounded channel-0 liveness RPC retires the
generation on silence. EOF retains stale observation without actionability.
Consume sequence positions for linked-machine events even when their entities
are hidden. Snapshots do not contain documents; no World consumer needs a core
document model.

### 5. Admission limits

Descriptor budgets bound line bytes, per-terminal label bytes, snapshot bytes and
entity counts, mirror memory and browser queues. Exceeding any limit retires host
actionability without partial admission or implied deletion. Resubscription backs
off. Required fixtures include silent suppression of an oversized `missed`,
detected by the later heartbeat jump.

### 6. Native parameters

Construct fresh native arguments from typed verbs. Background get/read/send have
no `caller`. On direct connections reject `on`, slash-qualified terminal/parent/
child addresses, `machine.*`, `file.*`, `server.stop`, `server.restart`,
`terminal.put` and `via`; refuse raw RPC pass-through for core. Labels, documents,
status and `<hc from>` are display data, not provenance. Existing guarded host
helpers retain file/Git/upload authority and symlink policy.

### 7. Reads

Background, peek, witness and Ranger reads use `terminal.read {lines:0}` without
caller. History comes from attach history or browser scrollback. Stitched reads
inject input and therefore require current control authority.

### 8. Session input

Messages, answers and asks use core's own `terminal.send` and `terminal.keys`
for every harness supported by herdr-core and herdr, not only Claude and Codex.
Immediately before each send/keys dispatch, World checks the original occupant
and its current foreground on the captured connection lease. Changed or missing
evidence refuses dispatch until freshly verified. World builds no per-harness
side channel and does not take over core's input scheduling.

A native send queue can outlive its connection and execute in a kept replacement
shell. World's pre-send check is required but cannot close that later window;
core owns closing it (Q3). The model's execution-time source gate is that upstream
assumption, not a World delivery mechanism or a claim about current core.
Show a timeout as "uncertain", retain the original recipient and never retry an
unanswered possible write automatically. Deadlines include quiet and draft
windows; `SendResult.started` proves observed activity, not recipient identity.
Interactive terminal input and Details keys retain their terminal uncertainty
contract and do not grant session delivery authority.

### 9. Terminal streams

Use one observe stream per visible browser context with independent credit.
Request `resize_notifications:true`, require confirmation, and apply each
core-to-viewer RESIZE before following DATA and the first paint. Browser fitting
cannot replace the authoritative PTY grid. A transport lacking confirmation needs
a tested size-event fallback or refuses attachment. Observers send no human DATA,
RESIZE or FOCUS. An observer attaching alone may trigger core's headless grid
(default 200×120); document this exception.

Open an interactive stream on the first genuine key in a focused terminal; queue
that key and send it exactly once after confirmed attach. FOCUS accompanies real
input only. Send terminal replies as AUTOMATIC_INPUT at their source only when
hello and attach both confirm support. Keep interactive while visible and focused;
after focus/visibility loss detach on idle. Core may return to headless size when
no other interactive viewer remains. Windows encoding obeys win32-input-mode.

### 10. Runtime and session selection

When installed, core is the default for new agent and shell launches; TUI is an
explicit per-launch choice. A stopped default runtime presents the separate start
action. World launch bootstrap includes runtime, core ID, terminal address and
session token. Outside launches' `HC_TERMINAL_ID`/`HC_TERMINAL_SOCKET` and `HERDR_*`
are claims: verify process ancestry on the matching connection. If both sets are
present, verify both and choose the nearest ancestor PTY; refuse unresolved
ambiguity. Diagnose inherited TUI markers when core was started inside a TUI pane.

### 11. Mixed hosts and release policy

TUI and core connections on the same host keep separate identities and generations;
do not fold by argv or regroup by host. Every core release receives full read-write
support. Do not pin versions, require certification, show an uncertified-write
gate or downgrade new releases to read-only. Negotiate required protocol methods
and features and fail an actually unsupported operation explicitly; a missing
capability is not a version allowlist. Smoke the newest official release to flag
drift and fix World as core and TUI evolve. World never runs `hc update`.

## Ownership decisions (M1–M11)

| ID | Contract |
| --- | --- |
| M1 | World SQLite owns workspace → tab → split topology, order, empty rooms and geometry. Render with existing Spaces/windows; moves stay World-local. Neither read nor write the app's layout document. `where` may be a caption. |
| M2 | App placement defaults on for agent launches and off for plain shells. Write `herdr.space`/`herdr.tab` once at launch, never on World moves. Explain independent layouts, adoption's `keep:true`, pane close ending the terminal and parent death still applying. World-started reporting agents must appear in the apps; verify desktop and phone separately. |
| M3 | Compile existing agent profiles, resolve an absolute host executable, then run explicit argv/cwd/env/size/keep/outlive_parent. No caller; default no_parent and no_notify. Templates are a separate explicit mode. Readiness is not session evidence. |
| M4 | Chat send, answers, ask delivery, summaries, checkout claims and stamps require verified occupant-bound session evidence. Labels cache it without granting authority. Chat is transcript-only; missing evidence/transcript offers unavailable or manual linking. For every supported harness, messages/answers/asks use core send/keys with an immediate occupant+foreground check, timeout shown as uncertain and no per-harness side channel (§8); the queued replacement window belongs to core (Q3). |
| M5 | Asks/results remain in World's ledger, capture the original verified recipient and dispatch through core under M4/§8 without retargeting or automatically retrying uncertain writes. Core owns the queued-send race (Q3). Never rewrite native status to represent an ask. |
| M6 | Task summaries work without a World service: a verified runtime-local CLI writes one namespaced label with normalized summary, session fingerprint and absolute expiry. Readers check both; reconnect does not renew TTL. |
| M7 | Spawn stamps are World display relations. Native parentage is only for deliberate verified same-core children. Before every native kill, room close or bin action, list descendants whose parent/die_with_parent means they die, name them in confirmation and kill no more than the confirmed set. |
| M8 | cwd, checkout reports and Git provide evidence; consequential worktree binding still requires session proof. |
| M9 | Share herdr.seen and herdr.pinned best-effort. Seen is raise-only once per visibly seen turn; missing is not zero; unread is turn−1; blocked/error outrank seen. Viewing done clears done across apps. Re-read before writes, preserve explicit unread and disclose last-writer races without CAS. Review receipts and desk/card pins remain World-only. |
| M10 | World's own SSH connection per host owns authority. Linked machines are discovery only; hide their actionable entities/counts when a direct connection has the same core ID, while consuming all event positions. |
| M11 | World reads agent status from core and never writes it, including for integrations World installed. Missing status remains unknown; a reporting timeout never authorizes injection. |
