# herdr-core-runtime notes

[Contract](spec.md). Navigation and usage guidance; contracts live in OpenSpec.

**Surfaces:**

- Core desks, native terminals, room shells, launcher and core placement operations.

**Code:**

- `server/src/herdr-core/host-runtime.ts`
- `server/src/herdr-core/host-runtime.test.ts`
- `server/src/herdr-core/town-move.ts`
- `server/src/herdr-core/town-moves.test.ts`
- `server/src/herdr-core/connections.test.ts`
- `server/src/agent/process-transcript.ts`
- `server/src/herdr-core/history.ts`
- `server/src/agent/process-transcript.test.ts`
- `server/src/herdr-core/headless-chat.test.ts`
- `server/src/herdr-core/harness.ts`
- `server/src/herdr-core/history.test.ts`
- `server/src/world/agent-move.ts`
- `server/src/world/agent-move.test.ts`
- `server/src/world/agent-move-views.test.ts` (two connections of one Herdr
  through the real TUI side)
- `server/src/world/agent-move-sides.ts`
- `server/src/world/move-settle.ts`
- `server/src/world/agent-rehome.ts`
- `server/src/rpc/agent-move.ts`
- `shared/agentMove.ts`
- `server/src/herdr-core/shared-state.ts` (`waitsWithoutResult`: started-harness readiness)
- `server/src/herdr-core/harness-start.test.ts`
- `server/src/herdr-core/testing/capture-harness-start.ts`
- `server/src/herdr-core/testing/recorded/core-0.1.21-harness-start.json`
- `server/src/herdr-core/core.live.test.ts` (native status in the unified read model)
- `server/src/herdr-core/harnesses.live.test.ts` (ready, blocked and completed reports)
- `scripts/herdr-core-smoke.ts` (checksum-verified newest-release live suites)
- `scripts/release-walk/contract.py`, `scripts/release-walk/assets.py` (pinned
  release-walk core download and receipt version)
- `scripts/check-homebrew-runtime.rb` (Homebrew install acceptance fixture)
- `server/src/herdr-core/`

**Pitfalls:**

- Core desk moves use native placement, not TUI split replay.

## Usage reference

## Runtime support

A host is this computer or one exact OpenSSH alias / `user@host` destination.
The service and CLI discover herdr-core and the Herdr TUI on each host and connect
every runtime found. `herdr-world connections add sample@host.example` needs no
runtime flag. `herdr-world connections discover <host-id>` repeats discovery;
connecting a host also repeats it. Discovery checks presence and version, never
starts or installs a runtime. Saved live endpoints remain available even when
the runtime executable is off PATH. Core uses `HC_SESSION` locally (otherwise `default`)
and its standard state directory, including `XDG_STATE_HOME`.

An empty host stays saved and reports **No runtime installed**, with the registered
runtime choices. Installation always needs a person's action. Once any runtime is
found, host responses offer no installation suggestions; the Integrations API
lists additional runtime choices per host. A probe failure is an unavailable or
degraded host, never evidence that a runtime needs installing. SSH uses fixed,
bounded, noninteractive probes; passwords, keys and arbitrary SSH options are
never saved. Set SSH policy in OpenSSH configuration; use `--windows` for a Windows
SSH host.

Each runtime retains its own immutable connection ID and generation. One failed
runtime makes the host degraded while reachable siblings remain actionable.
Retained topology for the failed or removed runtime is stale and non-actionable.
Rediscovery reuses a removed runtime's ID, with a new generation on reconnect.
Legacy profiles on this computer or the same exact SSH destination become one host
without rewriting runtime IDs, room positions, pins, colours or saved Hosts filter
ticks. Different SSH aliases are not resolved or guessed to be the same machine.
Explicit startup socket/session/SSH overrides retain their pinned runtime behavior.
Per-runtime auto-connect settings remain effective after migration; a host's flag
reflects whether any member enables it. Startup connects the saved default and
profiles with auto-connect enabled, then discovers eligible hosts. A failed host
or catalogue write does not prevent other startup targets from connecting.
When automatic discovery finds only existing runtimes in a legacy registry, it
keeps discovery metadata in memory without rewriting that registry. An explicit
host discovery or a newly discovered runtime persists the host schema migration.
Disconnecting one runtime keeps it stopped when a sibling reconnects or its
per-connection Connect is used. Explicit host Connect or rediscovery connects all
found runtimes; newly discovered runtimes connect during automatic discovery too.

`herdr-world ls` returns hosts with their runtimes and rooms; `connections` lists
host/runtime kind, version and state. Existing per-connection API arrays and legacy
runtime-specific CLI add flags remain available. The current browser Hosts and
Manage connections screens still present runtime entries; their host grouping is
a separate screen change. See [host connections](../../../docs/host-connections.md) for the
API shape and migration rules.

herdr-core is primary for new agents when installed and connected. Choose a
Herdr TUI room to launch there instead.

`service uninstall` removes current and legacy World user services on macOS and
Linux when their definitions identify them as World-owned. It preserves settings,
tokens, unrelated services and herdr-core's login item.

✓ means supported. **partial** links to a limit; **not yet** means World has
no control for it. Platform and harness limits apply across the table.

| Capability | Herdr TUI | herdr-core |
| --- | --- | --- |
| Local discovery and connection | ✓ | ✓ |
| Unix host over SSH | ✓ | ✓ |
| Windows host over SSH | [partial](notes.md#runtime-limits) | [partial](notes.md#runtime-limits) |
| Town, Desk, Board and Needs you | ✓ | [partial](notes.md#runtime-limits) |
| Open terminals, type and resize | ✓ | [partial](notes.md#runtime-limits) |
| Start and stop agents | ✓ | [partial](notes.md#runtime-limits) |
| Room shells | ✓ (Herdr Float plugin) | ✓ (World's float shell) |
| Chat and asks | [partial](notes.md#runtime-limits) | [partial](notes.md#runtime-limits) |
| Files and Git changes | [partial](notes.md#runtime-limits) | [partial](notes.md#runtime-limits) |
| Worktrees | [partial](notes.md#runtime-limits) | [partial](notes.md#runtime-limits) |
| Ranger | [partial](notes.md#runtime-limits) | [partial](notes.md#runtime-limits) |
| Pins | ✓ (World only) | ✓ (shared with Herdr apps) |
| Notifications and chimes | ✓ | [partial](notes.md#runtime-limits) |
| Usage and fuel | [partial](notes.md#runtime-limits) | [partial](notes.md#runtime-limits) |
| Harness integrations | [partial](notes.md#runtime-limits) | [partial](notes.md#runtime-limits) |
| Herdr phone app pairing in World | [not yet](notes.md#runtime-limits) | [not yet](notes.md#runtime-limits) |
| World on your phone (browser/PWA) | ✓ | ✓ |

### Runtime versions

- **Herdr TUI:** the verified current range is **0.9.0–0.9.5**, terminal
  protocol **22**; World installs **0.9.5**. Legacy codecs **14–20** remain
  supported. Protocol **21**, older protocols and future protocols are refused.
  A newer TUI using a supported protocol can connect; it is outside this verified
  version range. Upgrade World for an unsupported protocol. Never downgrade a
  live server to make it connect.
- **herdr-core:** **0.1.22** is the verified baseline, also checked against
  **0.1.21**. There is no version pin or read-only certification gate: older
  and newer releases can connect when
  they provide the required methods and features. A missing feature is refused
  with a reason. Before 0.1.21, attaching an observer can move a terminal to
  core's headless size; World reports the move. The daily and manual
  [release smoke](../../../docs/development.md#herdr-core-release-smoke) checks newer
  releases for drift without changing your installed runtime.
  Release-walk acceptance pins **0.1.22** for repeatable runtime downloads and
  receipts; install previews and fake release fixtures use the same baseline.

### Runtime limits

- **Windows:** local core and Windows SSH core have not been tested on real
  hardware. Fake-host and PowerShell-on-Linux tests cover the transport, not
  real Windows ACLs, named pipes or keys. Core has no Windows ARM64 build.
  World can install core on local Windows x64; Windows SSH setup is manual.
  Windows hosts support terminals and native runtime controls, but not the
  Unix-based file, Git, worktree, transcript-history or usage tools.
- **Core releases:** unreleased changes after **0.1.22** wait for the next
  core release. Released versions retain read-write support; the smoke flags
  drift. The [protocol questions](spec.md#upstream-questions-q1q11)
  record the remaining upstream boundaries.
- **Views and rooms:** core supplies status. A harness that reports none stays
  **unknown**. Core agents have no quest controls or Town step bubbles; use
  Chat or Terminal. **Spaces** is a Herdr TUI workspace view. World arranges
  its core rooms separately from Herdr apps and cannot rename or close an
  app-created room. Linked-machine core terminals are observations, not
  directly controllable desks.
- **Town moves on core:** dragging a live core agent onto another desk moves
  it there; dragging its desk to another room moves every terminal at that
  desk. Moves patch `herdr.space`, `herdr.tab` and `where` without restarting
  programs, and update World's placement when it owns the desk. App spaces
  accept moves too. World-owned rooms stay when emptied; moving out of an app
  space does not close it in Herdr's app. Cross-room team joins can move the
  desk. A missing `terminal.label` capability, stale host or vanished target
  has a specific visible reason. A partial or uncertain move is reported and
  never retried automatically. Core has no native desk-order operation;
  unpinned reordering explains that limit, while pinned desks retain World's
  saved ordering among their room's pinned seats.
- **Move agents between runtimes:** drag a desk into a room of the other
  runtime (Herdr TUI ↔ herdr-core), or choose **Move to…** on its Town peek,
  in Town's **M** chooser (rooms marked "another runtime") or on its Board
  peek; on Board, dropping a single-terminal card on another runtime's tab
  works too. World starts the agent's harness in that room with its
  conversation resumed (`claude --resume`, `codex resume`) in the agent's
  folder. For a core agent World finds the conversation from a session linked
  in its Chat, Claude's process record, the rollout file Codex holds open
  (its name carries the session ID), or the launch arguments; a Codex that
  no longer holds its rollout open needs its session linked in Chat first.
  With nothing to resume (a plain terminal, or an agent World cannot
  find a conversation for) World first says the conversation won't continue;
  once you confirm, it starts a new shell, or the same harness fresh, in the
  same folder. It waits until the new one is
  ready, carries the desk's colour, pin, Board place, strings and spawn lines
  to the new desk, then closes the original. Moves within one runtime still
  use that runtime's own move and keep the agent running. A pinned desk moves
  to any room it can go to, on either runtime, and stays pinned there, so a
  desk moved in from Herdr TUI (pinned) moves on again. Refused, with the
  reason, and nothing started: a working agent or one waiting for an answer,
  a plain terminal running a program, a desk with more than one terminal, a
  core agent whose own
  spawned agents would end with it, a runtime on another machine, or a stale
  or reconnected host. If the new agent does not start within a minute, the
  half-started one is closed and the original keeps running. If the original
  starts working, splits or starts agents of its own before it closes, the new
  one is closed and the original stays, desk and all. When a runtime
  does not confirm that an agent ended, or a reply is lost, World says which
  one may still be running instead of reporting a move: a lost start keeps the
  original and names the new one; a lost close that leaves the original
  unreadable keeps the new one and its desk.
  Codex keeps one conversation open at a time, so a Codex agent closes first
  and then resumes in the new room; if it doesn't start there it resumes back
  in its own room, and if that fails too the message says which `codex
  resume` command continues it. A Claude copy that reports a new
  conversation instead of its own is closed and the move goes the same way.
  Two connections that reach the same Herdr are one runtime: Move to…
  doesn't offer the other's rooms as another runtime, and a move between them
  is Herdr's own. A core desk moved to another core room keeps running and
  keeps its Board colour, pin and links. Each move step is logged by the
  service under `agent-move` (`move admit`, `move start`, `move recheck`,
  `move rehome`, `move close`, `move unpin`, `move outcome`), and a refused
  move's toast shows the reason. A Herdr TUI original counts as closed only
  once Herdr stops showing it (about five seconds), else the move says it may
  still be running; a pin kept under the other connection of the same Herdr
  goes only then. A moved agent can't
  move again for about 20 seconds ("still settling"). A move outlives the
  page's socket: each move carries a `move_id`, and a page whose socket
  closed mid-move asks again with `follow` once it reconnects and gets that
  move's outcome (`server/src/rpc/agent-move.ts`, kept in memory ten minutes;
  `move reply lost` and `move follow` in the log). The page's heartbeat keeps
  a slow socket that still delivers (`web/src/api.ts`), so a remote link
  doesn't close it mid-move.
- **Core agent environment (Unix):** New agent finds and starts the harness
  through the core host's `$SHELL` (`/bin/sh` when unset): interactive on Linux,
  login and interactive on macOS. Supported shells are sh, bash, zsh, dash,
  ksh, mksh and fish. Their startup files can add tools such as nvm and bun.
  World receives the executable path, without collecting,
  copying or saving the shell environment. Other shells (including csh, tcsh,
  nu, xonsh and elvish) keep direct launching with the inherited environment;
  their startup files are not loaded. Startup files that replace the shell
  with another shell or tmux can prevent launch or time out the catalog probe.
  Windows keeps native launching.
- **Core launch arguments:** choose a room whose launcher says **Starts in
  herdr-core**; a room's name alone does not identify its runtime. World gives
  core the executable and arguments directly, including long Claude settings
  and multiline prompts. It does not type a launch command into a terminal.
- **Claude in Herdr TUI rooms (Unix):** Quick start and profile launches give
  Claude a short settings-file path, so the full status-line tap cannot be cut
  off by a terminal's input-line limit and leave the shell at a `> ` prompt.
  World prepares the file on the selected host, outside terminal input, in
  `~/.cache/herdr-world/claude-launch/`. Files contain only World's tap settings,
  are private to the user and reused for identical tap content; user settings
  stay untouched. If preparation fails, New agent reports an error before
  creating a tab or starting an agent. Windows keeps inline settings.
- **Core agents run by wrappers and headless:** a core desk shows the agent
  that runs in its terminal's foreground, as Herdr's TUI finds it: the
  foreground program, else, on a core on this machine (Linux), the processes
  in its foreground group, nearest first. So `bash run.sh` running
  `claude -p … | tee log`, or `sh -c "claude …"`, shows Claude, looking as if
  started directly; a plain shell running `git` or `bun test` stays a plain
  terminal. A remote or macOS core reports only the foreground program, so a
  wrapper there shows its agent only once the agent reports status itself.
  A live headless run (`claude -p`, `codex exec`, `gemini -p`,
  `opencode run` and the like) counts as working, report or none, unless it
  asks you something. An interactive agent's status is its own report; with
  none it stays unknown, never working. A working or waiting report from an
  agent that has left the terminal (killed mid-turn, with a shell, editor or
  empty wrapper in front) is stale: World shows it idle, so it walks to the
  bar and its desk and room go dark. A report speaks only for the harness that
  runs: when another harness replaces the one that reported, or a new process
  starts after World saw the reporter exit, the newcomer is unknown (working,
  if headless) until it reports itself. An agent World saw run inside a
  still-running wrapper stays at that desk's terminal after it exits, idle, so
  it walks to the bar between headless calls instead of vanishing; once the
  wrapper ends and the shell is back, the desk is a plain terminal again. A
  word that is an option's value never marks a run headless
  (`codex -C exec` is interactive Codex in a folder named `exec`). A shell
  function or alias piped into another command (`f | cat`) runs as a copy of
  the shell; World looks inside it as it does a wrapper.
- **Codex status on Linux core:** working/idle comes from Codex's native
  OSC 7501 reports, just as on macOS. If core publishes no status, World
  shows **unknown** even when Chat and Terminal work. World cannot recover
  missing core/harness reports from the screen or transcript; that reporting
  limitation needs a fix in the runtime or harness. Linux core **0.1.21** with
  Codex **0.167.0** can publish idle/working; the missing-report case is not
  a general Linux status-mapping restriction in World.
- **Started agents show ready:** Codex reports working for a moment while it
  starts, so core counts a turn before anyone asked it anything, and World's
  launch sets `herdr.seen=0`. Claude Code and Codex end a turn that has a
  result with `done`, so World shows them **idle** whenever they say idle,
  and pushes no finished alert for that turn. Other harnesses keep Herdr's
  rule (idle above seen is done). A World page looking at the desk raises
  `herdr.seen`, which is why older builds only sometimes showed `done`. To
  re-record with a new core or harness:
  `HERDR_CORE_BIN=<herdr-core> bun server/src/herdr-core/testing/capture-harness-start.ts <out.json>`
  (scratch core and harness config; it copies only the sign-in files).
- **Terminal size:** watching never sends a resize. An open core Terminal tab
  also holds an interactive viewer: it fits the terminal only when no Herdr
  app pane holds it. Typing takes the size by core's rule; using an app pane
  takes it back. Closing or minimizing gives it back. Older cores have the
  observer exception above. Core allows four watches per page and 32 per service.
- **Core input and stopping:** World checks the original program before a send
  or kill. Core can still type queued input into a replacement shell, or end
  a new child created during a kill. World names any extra ended terminals.
  An **Uncertain** result is never retried automatically; check before trying
  again. See upstream questions Q3 and Q11 in the protocol questions above.
- **Chat and asks:** transcript support depends on the
  [harness and platform](../../../docs/core-harnesses.md); input can still work without
  a readable conversation. On Linux and macOS, core Chat can identify headless
  `codex exec` and `claude -p` conversations from the foreground process's own
  session record or unique writable transcript (or Claude session debug file).
  SSH discovery runs on that agent's host. It never chooses the newest Claude
  or Codex file in a directory: missing, unreadable or ambiguous process evidence
  leaves Chat unavailable unless an explicit session reference is present.
  Runs that disable session persistence have no transcript to read.
  Verified local Linux asks can receive saved answers
  in their original session. Remote and unverified asks use `ask get` or `--wait`.
  `--owner-only` means only you can answer.
- **Ranger:** on core it reads the current screen, not terminal scrollback or
  agent history. Use World's controls to start/stop agents or split terminals.
  Its file and worktree tools need a Unix host.
- **Notifications:** core sends Web Push for working → done and needs-you
  status changes. It has no Herdr TUI custom notification stream or its
  “for you” chimes. A core push opens World, without a verified Chat-session
  target. Browser permission and HTTPS requirements apply to both runtimes.
- **Usage and integrations:** World's usage/fuel collector reads Unix Herdr TUI
  and core connections for Claude Code, Codex, Pi and Gemini. Core attribution
  needs explicit resume/session arguments or a uniquely resolved Codex title;
  other records remain host-level. World's harness skills work with
  either runtime; core status comes only from core, never TUI hooks or screen
  inference. See [integration differences](../../../docs/harness-integrations.md#runtime-differences).
- **Phone pairing:** World has no pairing UI for Herdr's phone app on either
  runtime. Use Herdr's own tools for that app. To use World on a phone, open
  World's URL and [install its PWA](../../../README.md#install-as-a-pwa).

This table follows the [TUI protocol checks](../../../shared/herdrIdentity.ts),
[core connection tests](../../../server/src/herdr-core/connections.test.ts),
[host tools](../../../server/src/herdr-core/host-runtime.test.ts),
[core controls](../../../server/src/rpc/core.test.ts) and
[service wiring](../../../server/src/service/world-service.ts).

Agent questions, answers and task results survive service restarts in the
instance's private `world.sqlite`. The service sends alerts for you from a durable
outbox; an interrupted send retains explicit uncertainty. Retrieve answers with
`herdr-world ask get ID` or `--wait`. New asks from a verified local Linux
agent can also receive the saved answer in their original Chat session without
`--wait`. Town Summary’s Outbox keeps waiting, unconfirmed and not-sent deliveries separate
from open questions; you can close a delivery or explicitly resend to the
same session after accepting a possible duplicate. A changed session is skipped.
See [migration and backups](../../../docs/DEPLOYMENT.md#durable-questions-results-and-backups).

The service also exposes shared [harness usage data](../../../docs/usage.md): bounded
token records from Claude Code, Codex, Pi and Gemini logs on qualified local or
SSH hosts, with source health, host/workspace/tab/pane rollups and optional
versioned price-table estimates. Town's expenses boards and Board's summary,
host zones and workspace cards read it (below).

The [usage analytics API and CLI](../../../docs/usage-analytics.md) expose that data by
agent, Git project, room or UTC day through `world.usage.analytics` and
`herdr-world usage`. Active and waiting-on-you milliseconds are observed runtime
status intervals, with explicit partial coverage; idle is never owner wait and
gaps remain unknown. Numeric daily time history stays in the instance's private
data folder for seven days; open intervals never resume after restart. Tokens
come from existing logs, Pi's explicitly recorded cost is separate from optional
price estimates, and Claude/Codex cost stays unknown without reported numbers.
PR counts are distinct known authored PRs in the configured work-source catalogue,
with source creation/merge dates and current session-qualified links for agent
attribution. Missing sources never imply zero. Reads refuse unqualified pane/room
filters, unsupported windows and arbitrary paths. `usage --fixture` runs a
synthetic example offline, including an owner wait and a usage limit.
