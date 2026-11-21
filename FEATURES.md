# Herdr World Features

A Web/PWA client for the **Herdr TUI**, **herdr-core**, or both.
[Install it](./README.md#quick-start) or follow the [tutorial](./docs/TUTORIAL.md).

## Shipyard

- `herdr-world shipyard list|show` and the same-origin
  [Shipyard API](docs/shipyard-api.md) read GitHub releases, tags, workflow health
  on the observed main commit and merged changes waiting after the release
  baseline. All authors count; membership follows the commit graph, not dates.
- Channels are stable or prerelease. Drafts and bare tags do not count as shipped.
  Missing, stale, diverged or shortened data stays explicit; it never means
  “nothing waiting” or permission to release. The existing GitHub Sources switch
  and service user's `gh` sign-in apply. Reads share a bounded cache and deadline.
- Running World listeners report their versions, ports and known source branches
  in a private local registry. Isolated previews can opt into one shared registry;
  expired reports are stale and have no open action. Only fresh loopback reports
  provide navigation URLs, usable from the service machine. No remote host or
  port discovery runs, and agent runtimes are not treated as World deployments.
- V1 provides navigation links only: no release/tag creation or deployment
  changes. `herdr-world shipyard demo --scenario stale|limited --json` exercises
  synthetic rare states without a service or credentials.
- **Town harbour**: a wide Town ends at its right-most edge in the sea, which
  runs on off the map. The streets end at a stone promenade; one shipping lane
  per project crosses the water from it, each in its own colour (eight colours
  that repeat), named on a board with its flag at the pier's root. Projects are
  the repositories the Shipyard suggests (up to eight) plus the one chosen in **Work →
  Releases**, which comes first. On a lane, the hull on the slipway is the next
  release, with the count of merged pull requests waiting for it (`200+` when
  shortened, `?` unknown); the latest three releases are ships moored along the
  pier, newest first, prereleases with orange hulls and a green pennant while a
  World on this computer runs that version. The lighthouse at the pier's head
  is main's checks (green passing, red failing, yellow running, grey unknown).
  The Shipyard sign counts projects and those with main failing or out of date.
  A board or hull opens that project in **Work → Releases**; a ship opens its
  release card with **All releases**. A new release sails in once, only in its
  own lane, and is announced; the first read and a repository change stay
  still. More projects than the sea holds (about thirteen on a one-building
  town) end in a **+N more** lane listing the rest by name and state; each opens
  in **Work → Releases**. Stale data fades a lane, greys its lamp and says
  **Out of date**; so does a failed read of that one project, keeping its
  last ships, and a failed read of World itself, and then every
  running World reads as stopped reporting without **Open**. GitHub off or no
  repository leaves an empty sea and says how to go on. A phone or portrait
  Town has the same harbour right of its stacked buildings: drag or pinch to
  reach it, or tap the **Shipyard** signpost on the town center's left wing
  (a dot per project in its colour and lamp, and an arrow), which flies to
  the sea with the promenade and a whole pier across the screen. Calm Town
  and reduced motion stop the bobbing and
  sailing. Open pull requests are the warehouse's, not the harbour's.
- **Work → Releases** (Board's Work lens and Town's harbour): main's checks,
  waiting changes, shipped releases and running Worlds, with links to GitHub
  and **Open** only for fresh loopback Worlds (usable on the service machine).
  Waiting changes list the merged pull requests the commit graph proves and
  the total commit count; World does not guess which commits were pushed
  directly. The repository select, including **Another repository…**, is remembered per
  browser. **Read GitHub again** forces one bounded refresh.
- Testing only: `?shipyardFixture` (or `=failing|stale|limited|off|empty|offline`)
  shows synthetic data without GitHub, three projects; `=many` shows sixteen,
  more lanes than a town's sea holds. The page drops the parameter at once.
  `offline` answers once, then fails every read as if World stopped answering.

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
Disconnecting one runtime keeps it stopped when a sibling reconnects or its
per-connection Connect is used. Explicit host Connect or rediscovery connects all
found runtimes; newly discovered runtimes connect during automatic discovery too.

`herdr-world ls` returns hosts with their runtimes and rooms; `connections` lists
host/runtime kind, version and state. Existing per-connection API arrays and legacy
runtime-specific CLI add flags remain available. The current browser Hosts and
Manage connections screens still present runtime entries; their host grouping is
a separate screen change. See [host connections](docs/host-connections.md) for the
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
| Windows host over SSH | [partial](#runtime-limits) | [partial](#runtime-limits) |
| Town, Desk, Board and Needs you | ✓ | [partial](#runtime-limits) |
| Open terminals, type and resize | ✓ | [partial](#runtime-limits) |
| Start and stop agents | ✓ | [partial](#runtime-limits) |
| Room shells | ✓ (Herdr Float plugin) | ✓ (World's float shell) |
| Chat and asks | [partial](#runtime-limits) | [partial](#runtime-limits) |
| Files and Git changes | [partial](#runtime-limits) | [partial](#runtime-limits) |
| Worktrees | [partial](#runtime-limits) | [partial](#runtime-limits) |
| Ranger | [partial](#runtime-limits) | [partial](#runtime-limits) |
| Pins | ✓ (World only) | ✓ (shared with Herdr apps) |
| Notifications and chimes | ✓ | [partial](#runtime-limits) |
| Usage and fuel | [partial](#runtime-limits) | [partial](#runtime-limits) |
| Harness integrations | [partial](#runtime-limits) | [partial](#runtime-limits) |
| Herdr phone app pairing in World | [not yet](#runtime-limits) | [not yet](#runtime-limits) |
| World on your phone (browser/PWA) | ✓ | ✓ |

### Runtime versions

- **Herdr TUI:** the verified current range is **0.9.0–0.9.5**, terminal
  protocol **22**; World installs **0.9.5**. Legacy codecs **14–20** remain
  supported. Protocol **21**, older protocols and future protocols are refused.
  A newer TUI using a supported protocol can connect; it is outside this verified
  version range. Upgrade World for an unsupported protocol. Never downgrade a
  live server to make it connect.
- **herdr-core:** **0.1.21** is the verified baseline. There is no version pin
  or read-only certification gate: older and newer releases can connect when
  they provide the required methods and features. A missing feature is refused
  with a reason. Before 0.1.21, attaching an observer can move a terminal to
  core's headless size; World reports the move. The daily and manual
  [release smoke](./docs/development.md#herdr-core-release-smoke) checks newer
  releases for drift without changing your installed runtime.

### Runtime limits

- **Windows:** local core and Windows SSH core have not been tested on real
  hardware. Fake-host and PowerShell-on-Linux tests cover the transport, not
  real Windows ACLs, named pipes or keys. Core has no Windows ARM64 build.
  World can install core on local Windows x64; Windows SSH setup is manual.
  Windows hosts support terminals and native runtime controls, but not the
  Unix-based file, Git, worktree, transcript-history or usage tools.
- **Core releases:** unreleased changes after **0.1.21** wait for the next
  core release. Released versions retain read-write support; the smoke flags
  drift. The [protocol questions](./openspec/specs/herdr-core-runtime/spec.md#upstream-questions-q1q11)
  record the remaining upstream boundaries.
- **Views and rooms:** core supplies status. A harness that reports none stays
  **unknown**. Core agents have no quest controls or Town step bubbles; use
  Chat or Terminal. **Spaces** is a Herdr TUI workspace view. World arranges
  its core rooms separately from Herdr apps and cannot rename or close an
  app-created room. Linked-machine core terminals are observations, not
  directly controllable desks.
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
  [harness and platform](./docs/core-harnesses.md); input can still work without
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
  inference. See [integration differences](./docs/harness-integrations.md#runtime-differences).
- **Phone pairing:** World has no pairing UI for Herdr's phone app on either
  runtime. Use Herdr's own tools for that app. To use World on a phone, open
  World's URL and [install its PWA](./README.md#install-as-a-pwa).

This table follows the [TUI protocol checks](./shared/herdrIdentity.ts),
[core connection tests](./server/src/herdr-core/connections.test.ts),
[host tools](./server/src/herdr-core/host-runtime.test.ts),
[core controls](./server/src/rpc/core.test.ts) and
[service wiring](./server/src/service/world-service.ts).

Agent questions, answers and task results survive service restarts in the
instance's private `world.sqlite`. The service sends alerts for you from a durable
outbox; an interrupted send retains explicit uncertainty. Retrieve answers with
`herdr-world ask get ID` or `--wait`. New asks from a verified local Linux
agent can also receive the saved answer in their original Chat session without
`--wait`. Town Summary’s Outbox keeps waiting, unconfirmed and not-sent deliveries separate
from open questions; you can close a delivery or explicitly resend to the
same session after accepting a possible duplicate. A changed session is skipped.
See [migration and backups](./docs/DEPLOYMENT.md#durable-questions-results-and-backups).

The service also exposes shared [harness usage data](./docs/usage.md): bounded
token records from Claude Code, Codex, Pi and Gemini logs on qualified local or
SSH hosts, with source health, host/workspace/tab/pane rollups and optional
versioned price-table estimates. Town's expenses boards and Board's summary,
host zones and workspace cards read it (below).

The [usage analytics API and CLI](./docs/usage-analytics.md) expose that data by
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

## Agent and project memory data

The [memory service, API and CLI](./docs/memory-api.md) browse, search, read, add,
edit and delete harness memory on its owning local or SSH connection. Claude
instructions, rules and project/subagent memory, Codex instructions and v1/v2
Markdown memory, and Pi instructions share one model for TUI and core. Sources
show current project/agent sharing; entries show bytes, modification time, a
30-day age hint and per-harness default load candidates or shadowing. Unknown
harnesses and missing/refused sources are explicit. Discovery cannot prove what
an already running agent loaded; per-process overrides, imports, trust, custom
fallback names and project settings can change that. Reload in the harness after
editing; generated Codex memory can be regenerated by the harness.

Every service call requires an immutable connection ID and observed generation
(`herdr-world ls --json` now includes `connection_generation`). Writes require
`--user-action`; update/delete need a current read revision, and deletes also
require `--yes`. Conflicts preserve the current file; an unknown write outcome
requires a fresh read. Nothing retries a write automatically. Contents stay on
the owning host and in private responses, without a World content cache, index,
Board copy or telemetry. The Library (below) is the browser's view of this data.

The Unix host needs Python 3; Windows, symlinks, hardlinks, special/binary/non-UTF-8
files and non-Markdown entries refuse. Discovery stops at 32 projects, 128 agents,
256 sources and 512 entries, four directory levels, and 256 KiB per file. Search
is literal and case-insensitive, with a 2 MiB scan budget and 100 results. Partial
results say `truncated`, skipped reads are counted, and each host request has a
15-second deadline. `herdr-world memory demo --json` creates and cleans up an
isolated synthetic fixture for sharing, old memory, CRUD, refusals and limits.

### The Library

- Open it from Town's **library**, right of the town center on the first street,
  from the town center's ring (**Library**), from Board's hub (**Library**, on the
  selected agent or workspace), from an agent window's settings (**Memory**)
  or from Settings (**Agents** → **Library (memory)**, or search "memory").
  On a phone the library folds to a book sign on the town center's left wing.
  The library's sign counts files, stale files and shared files across up to four
  hosts, read at most every five minutes; it never shows contents.
- The left column (a picker on a phone) chooses a reader: everything on a host,
  a project or an agent. An agent leads with what it would load: files read at
  start, files read when needed and files skipped, shadowed ("Hidden by another
  file") or empty. Discovery cannot prove what a running agent already loaded.
- Shelves group files by source, `MEMORY.md` first. Each file shows its size, its
  age (stale after 30 days) and who else reads it. Refused sources and files say
  why; a missing instruction file offers **Create** and a missing memory folder
  (a fresh project) offers **Add the first note**, which creates the folder;
  harnesses World cannot read
  say so; truncated lists and searches say they show the first ones only.
- Opening a book reads it fresh from its host. **Edit** then **Save** writes it
  with the revision you read. If the file changed meanwhile, the save is refused,
  your text stays and **Load latest** shows theirs. When World can't tell whether a
  write landed, it reads the file again: if the host has your text it says
  Saved; otherwise your text stays on the revision you started from, so saving
  again is refused if anyone else changed the file. **Delete** asks
  first, focused on its button, with **Keep it**; deleting a topic says if
  `MEMORY.md` still lists it. **+** on a shelf adds a note, reminding you to add
  Claude topics to `MEMORY.md`. Reload the harness to pick up changes.
- **Search** runs on submit over the chosen reader's files; tap a match to open it.
  Choosing another reader or host drops a search still under way.
- The Library stays on the host it opened on or you picked. If that host
  disconnects, it says the host's memory is unavailable and offers the other
  hosts; it never shows another host's agent in its place.
  Escape, system Back or the close button closes the Library; on a phone a book
  shows one pane with its own **Back** to the shelves. Opening the Library reads
  the host again. File contents are never cached; only the sign's counts are.
- To try it without real memory, open World with `?memoryFixture`: a synthetic
  host with two projects, four agents, shared, stale, shadowed, empty, missing and
  refused files. The page drops the parameter at once; edits stay in the page.
  Saving text that contains `[uncertain]` acts out a write whose outcome is
  unknown while someone else edits the file.

## World update notifications

- An available release notifies once per version in each browser profile and World
  origin, with an atomic IndexedDB claim across windows and persistent history
  across reloads and service restarts.
- Dismissing the notification keeps the red **Menu** attention dot and explicit
  **Upgrade to <version>** action. Failed upgrades keep a reachable retry;
  successful upgrades or a current-version check clear attention.
- Existing installation-channel, confirmation-header and restart safety checks
  remain in force. If persistent storage is blocked, only page-lifetime
  deduplication is guaranteed. Manual checking still gives completion feedback
  and remains reachable beside blocked Upgrade entries with visible guidance.
- A tab keeps running the build it loaded. When the service serves a different
  build (after an upgrade, rebuild, rollback or restart), a notice names both
  builds and offers **Reload** or **Later**; **Later** hides it until another
  build is served. **Menu** shows the tab's build, and the served build when
  they differ. If part of the app fails to load because its files are gone, a
  **Reload** notice appears instead of the page reloading itself, and again
  each time you reopen that part. **Upgrade &
  restart** still reloads once the restarted service is ready.

## Help and what's new

- **What can I do here?** opens World's help for the screen you are on: the
  **?** beside the views (desktop), the views button's menu (phone),
  **Menu → Help** (Settings at Help; the command box finds it too), Board's
  **⋯ → Help** and Chat's **⋮** tools. Tabs: **What's new**, **Town**,
  **Board**, **Chat** and **Everywhere**. Each entry has a picture of the real
  control (phone or desktop, light or dark, as your screen), its steps, where
  it lives and **Try**.
- **Try** closes the help, switches to Town or Board when the entry lives
  there, and rings the control for a moment. A Town control off camera (the
  Apartments sign below a phone's first view) is flown into view at the same
  zoom; Town itself never scrolls. A control inside a closed menu
  rings the button that opens it. When the control is not on this screen
  (Chat's controls without an open Chat, a phone-only control on a desktop),
  help reopens on that tab and says where to find it.
- **What's new from the Town Master**: after an update, the greeting lists up
  to four things new since the last version it showed in this browser, each
  with a picture and **Try**, and a link to all of them in help. A first
  visit shows **Start here**, the short first-run path, instead. Closing the
  greeting marks them seen; turning the greeting off leaves them in
  **Menu → Help → What's new**. Testing switch:
  `?whatsNewSince=0.3.0` shows what is new after 0.3.0, `?whatsNewSince=new`
  the first-run path; the address drops the parameter at once.
- The same entries make [docs/HELP.md](docs/HELP.md) and the website's help
  page. Help covers Town, Board, Chat and controls on every screen; other
  views are not described there yet.

## Visual control plane

Town, Board, Desk and Spaces are World's views. Office, Tree and Graph have been
retired: `/office` opens Town, and `/graph` and `/tree` open Board. Board and
these redirects are included in [0.2.6](./docs/releases/v0.2.6.md).

- **Town** is the default view (`/town`); the root URL opens it too.
  Each host is a building, each workspace a room, each tab a team table and each
  pane a seat. Rooms resize as tabs open and close; expanded rooms stay expanded
  as they shrink, until folded. Plain terminals show prompts. Additional panes beyond the drawn
  seats remain available through the table's count and chooser. Each table's
  nameplate shows its sole agent's Herdr name when exactly one named agent
  occupies the tab; otherwise it shows the tab's name, or `Tab N` if unnamed.
  Agents go by the name Herdr gives them (`firstmate`), else their harness
  (`claude`); window and Inspector titles put the name first
  (`firstmate · claude`).
  - The Town board counts the whole town, every building, in four one-word
    columns: **Busy** (working) agents, **Waiting** (items needing
    you: blocked agents and open questions, matching the reception tray and
    **Needs you**; a blocked agent with an open question contributes two
    items), **Done** (finished) and **Quiet** agents. A line under the counts
    gives every agent in the town and its buildings (and any of unknown
    status). It shows spend when a metrics provider
    is configured. Under **FUEL**, a gauge per harness with subscription-limit
    data (Codex from its session logs, Claude from its status line) shows a short bar per window
    (`5 h`, `week`) with the percent left; under 15 % left it turns amber and
    says **low**. A reading more than 15 minutes old shows its age under the
    bars in muted text, such as "seen 20 min ago"; past 30 minutes its levels
    dim and the age reads "as of 09:24", and a dimmed reading never turns the
    compact chip **low** on its own. A window the source did not send reads,
    for example, `5 h — not reported` instead of vanishing, and a harness with
    agents in Town but no reading from any host reads `Codex — no reading yet`
    in muted text. Hover, focus or tap a gauge for each reset time, how long
    ago the numbers were seen, their source and one line on what refreshes
    them. Old numbers (over 3 h, or past a reset) read **stale** with no level;
    with several hosts the board shows a current reading before a dimmed one,
    and among those the one with the least left. The summary window's hosts and
    Board's facts show each host's reading with the same rules, and name a
    harness with agents on that host but no reading from it.
    Claude gets its own gauge within about a minute of the first answer from an
    agent started from World's launcher: its status line passes Claude Code's 5 h and week windows to
    World, and the agent's status line looks as before. World shows Claude Code's
    own figure, which can trail claude.ai by about a point. Concurrent tap
    writers keep the highest comparable reading until reset, even if one pauses
    before publication. Only confirmed process death permits lock recovery;
    contention or unknown liveness skips a reading after about half a second
    and still runs the user's status command. When Claude refused
    work at its limit, the gauge reads **reached, resets …** instead of a level.
    Every row stays inside the board at its desktop, phone and Board widths: a
    longer value takes room from its bar, **reached, resets …** wraps, and a
    long caveat line under the economy figures ends in an ellipsis (hover or tap
    it for the full text).
    Chat and quests refresh usage stops after local transcript rewrites, including
    same-size writes whose file timestamps stay unchanged.
    The board stays folded into a compact status chip at the top left: one
    icon, **!N** in amber while N items need you, and the lowest fuel percent
    (or **reached**) only when a gauge is low or reached. Hover the chip with a
    mouse, or tap, click or focus and press Enter, to open the board below it as
    a popover. A click or tap keeps it open; Escape, a tap outside or another
    tap on the chip closes it. Opened by hover alone, it closes shortly after
    the mouse leaves the chip and board. The board's **Summary** button
    opens the **Town summary** window: blocked agents and
    questions you can answer in place,
    unreviewed finishes and when each was last active, every host and room
    with its counts (tap a room to go there) and its subscription limits
    (each window's percent used, reset time, source and age; stale or missing
    labelled; a Claude refusal reads "limit reached"), and spend per model ("No cost
    data" without a provider). Press **Summary** again to restore its minimized
    window or bring it to the front.
  - **Since you left**: after 30 minutes or more away (no visible World tab
    with input, on any device using this World service), the Town board sign
    starts with "Since 11:40 · away 3 h ✕" and up to four lines, most
    important first: new questions and newly blocked agents ("2 new for
    you"), who asked ("1 new question from builder"), finished work still to
    review ("5 finished"), and, with the GitHub source configured, pull
    requests merged meanwhile. Each line opens **Needs you** at its first item
    (the merged line, which names no item there, opens **Needs you** itself),
    where everything that arrived while you were away has a small "new" dot
    until you click or type in it. The recap only counts what still waits, so
    answering and reviewing shrink it; **✕** clears its lines on this browser
    without touching any item, until your next return. A phone shows it as one
    line under the summary chip ("Since 11:40: 2 for you, 5 finished ›"),
    which opens **Needs you**. Calm motion shows it without animation. The
    service remembers your last sighting in memory; after a service restart,
    each browser's own last sighting decides.
  - **Town Master greeting**: each visit (World opening, or its page coming
    back on screen after 30 minutes or more hidden), the Town Master, a small
    figure beside the town board, opens one card: hello with the time you
    were last here, the same **Since you left** lines as the board sign (each
    opens **Needs you** at its item; "Nothing new since you left." when there
    are none) and, when World's update check reports a newer release, one
    line whose **See update** opens **Menu** at its update entry (the greeting
    never installs anything). Board opens it at its hub beside the bin and
    Desk at its summary; a phone shows it as a sheet with **Back**. It never
    opens over an open window or sheet such as Chat or **Needs you**: on a
    phone it waits until they close; on a wide screen it waits only while one
    lies over the figure or the card's place, so an intent window or Chat
    docked on the other side does not hold it back. It also waits while
    Town's setup card (**Start Herdr** or **Set up herdr-core**) is up, and
    opens once the card is gone. **✕**, Escape, Back or a press outside closes it; tap
    the figure to open it again. Untick **Show this on start** at its foot,
    or switch **Menu → Settings → Town master greeting**, to stop it on this browser.
    Your very first visit is greeted too, without a last time. The card also
    carries [What's new](#help-and-whats-new) after an update, or **Start
    here** on a first visit.
  - **Tab and app icon count**: in every view, while anything needs you, the
    browser tab reads `(N) Herdr World`, its icon carries a small yellow
    badge (the number up to 9, then `9+`), and an installed World shows the
    number on its dock, taskbar or home-screen icon where the system supports
    app badges. N is the **Needs you** count. It keeps updating while the tab
    is in the background and follows answers made on another device; with
    nothing waiting the title and icon are plain again. Switch off
    **Menu → Settings → Count on tab and app icon** to stop it on this browser.
  - Each building has its reception at the top, under the front door, and a
    bar in its bottom corner. Blocked agents queue at reception oldest first.
    A queued agent without a Herdr name is labelled with its room rather than
    its harness, and its tooltip adds the desk, so the board says where each
    one waits from.
    A closed reception is a small marquee over the door, so hundreds of
    agents never bury the town under boards: the building's name, how many
    need you and the first five faces waiting (amber waiting, green done),
    with `+N` for the rest. Hover it, Tab to it, or tap it or its lobby, and
    the full board opens over it with every name, the sign, Tidy rooms and
    the expenses; it closes when the pointer or focus leaves.
    Finished agents wait there until you open their terminal or mark that
    completion reviewed, then join idle agents at the bar. Movement only
    represents state.
  - Each reception's sign shows the marks it takes: **!** Needs you, **?** Asks
    you and **✓** Done, with the ones it leaves out greyed. Press the sign to
    choose them for that building, or tick **Apply to all buildings** to give
    every building the same marks; **Reset to default** (all three) resets
    that building, or every building while **Apply to all buildings** is
    ticked. An agent whose mark its reception
    leaves out stays seated at its own desk with that mark overhead; it never
    walks to reception, the bar or anywhere else. Reception then shows a tag
    such as `✓ 4 at desks · find`: **find** opens the first of them and the
    card's **Next ›** steps through the rest. The filter moves bodies, not
    facts: marks, the Town board, room plaques, Board, Desk and Needs you
    count and list every agent as before. World saves the filter, so every
    browser and device shows the same one. Zoomed in to desks, where the
    reception boards are put away, tap a building's reception lobby to bring
    its board and sign back; any other tap or zoom level puts it away again.
  - Town shows what the crew spends. The **City expenses** billboard stands
    on the lawn above the town center, never over it: the whole World's tokens
    and estimated cost, such as "Today · 1.2M tokens · $3.40 est.", with a
    **Today** / **7 days** toggle. Each building's reception board ends with
    its **Expenses today**: the host's tokens and cost and its three
    costliest rooms. The Town board's **Economy today · UTC · harness logs**
    shows the same Today total and price-table estimate as the city board.
    Both windows share one read, and seven days includes today. Building totals
    add up to the city; unattributed usage is already included. Detail limits
    leave totals intact and are labelled. Figures come from [harness usage](./docs/usage.md). The
    boards never show a missing number as zero: without a price table they
    show tokens and say "no price table" (or "some models unpriced"); a host
    whose harness logs cannot be read says "no data"; a quiet host says
    "none recorded". Each figure has at most one short caveat line, such as
    "partial · stale left out · 1 host missing"; hovering it, or tapping it on
    a phone, explains each caveat in full, including usage tied to no pane or
    room ("unattributed", already in the totals) and a limited detail list. The boards re-read usage about once a minute and when the page
    regains focus; when re-reads fail, the last figures stay for at most five
    minutes and never past UTC midnight, then the boards read "out of date". On a phone the billboard stands above the town center as
    on a wide screen; each reception's expenses fold to a sign in its title
    (a phone keeps only a few rows of yard above each building for its
    reception board); tap one to open it. Zoomed in to desks, the boards are put away with
    reception. At every zoom the reception boards keep clear of the town
    center, the post office, the warehouse, the observatory, the billboard and each other: a
    board that would cover one slides aside the least it can while staying
    over its building, else it hangs lower, below the center or the board in its way.
    The `?scene=town-scale` preview replaces every economy reader with labelled
    test data for its synthetic buildings, including the Town board and Spend lens.
  - Town's **post office** stands on the first street left of the town
    center, on a phone as on a wide screen: Town's place for what is
    addressed to you, messages and never cargo (pull requests are crates in
    the warehouse; releases are ships). Its red sign on the roof counts,
    without hovering, what **Needs you** lists, by kind with the shared
    marks: "? 2 questions", "! 1 blocked", "✓ 3 to review", and "✉ 1 to
    check" for saved answers waiting in the Outbox; with none it reads
    "Nothing for you", and its rim turns gold while a question or a blocked
    agent waits. Click it, or focus it and press Enter, to open the same
    **Needs you** tab as the top bar's counter, where you answer, withdraw
    and reach the Outbox as usual; it is not a second inbox. It counts the
    hosts the Hosts filter shows, as Needs you does. On a phone the sign
    folds to a smaller red plate across the house's front, in view at home
    zoom, with the marks and numbers only; tap it for Needs you. Each open
    question for you (from `herdr-world ask`) is a letter in its yard,
    oldest first; a letter from a caller World could not verify has a grey
    seal. Hover or focus a letter for "Letter from orbit: …"; click or tap
    it for a card with the question, its answer choices, its age and
    **Answer in Needs you**, which opens Needs you at that question.
    Answers on their way to an agent ride the mail trolley by the door, red
    when one needs checking (delivery uncertain or refused); click it to
    open the Outbox. More letters than the yard holds make a "+N" bundle
    that lists the rest. For trying it without real questions, open World
    with `?townPostFixture` (four synthetic letters, one unverified, and
    three answers on the trolley; the sign counts them), `?townPostFixture=many`
    (a bundle) or `?townPostFixture=empty` (no mail); the page drops the
    parameter at once, only the post office uses it, and a test letter's
    card has nothing to answer.
  - Town's **warehouse** stands on the shore at the first street's end, by
    the harbour, its yard on the pavement: your open pull requests (opened by
    you, waiting on your review or assigned to you) as crates in its yard,
    ready to merge first. Its sign counts them without hovering, such as "2
    ready · 1 failing · 3 waiting", adding unknown and draft when there are
    some. A crate's straps and stencil show its state: green ready to merge,
    red CI failing on its head, amber waiting (for CI, a review, a fix or
    GitHub), grey for unknown and loose planks on a pallet for a draft. It
    reads the GitHub source and the pull request card's merge rules, so stale
    or partial detail is unknown, never ready. Hover or focus a crate for
    "#123 title", its repository and its state in words; tap it for the same
    pull request card the desk badge opens (**Details**, **Merge…** and the
    rest). A merged crate is carried off toward the quay for the next release
    (with calm or reduced motion it just goes); a closed one fades. More than
    the yard holds make a "+N" pile that opens the rest as a list. Click the
    warehouse's sign, or **All pull requests** at the top of the pile's list
    or the phone sign's list, to open Board's **Work** lens over Town: every
    pull request in the same columns, with the Tickets tab, each card's
    actions and the same Escape, Back or press-outside close. An agent on a
    card opens as tapping it in Town does. With the GitHub source off, signed
    out or not yet answered, the warehouse is closed and says to connect
    GitHub in **Integrations** (its sign opens them), with no crates and no
    counts; when a refresh fails it keeps the last list as unknown and says
    GitHub is out of date. On a phone it stands on the harbour's shore too,
    and a sign on the town center's right wing, in view at home zoom (a crate
    and "PRs", no counts: the post office counts what needs you), opens the
    crates as a list with their counts. Searching Town for "warehouse" (or
    "pull requests") lists the **Warehouse** and choosing it takes the map
    there, on a phone or a wide screen. For trying it without
    real pull requests, open World with `?townWarehouseFixture` (synthetic
    pull requests in every state; ten seconds later the first ready one
    merges), `?townWarehouseFixture=many` (a pile) or
    `?townWarehouseFixture=off` (signed out); the page drops the parameter at
    once and only the warehouse and the Work lens it opens use it.
  - Town's **observatory** stands on the first street right of the library,
    which stands right of the town center (a wide town grows rightwards to
    keep its lot; nothing moves). Its
    sign shows, for Claude and Codex, the **5 h** and **week** subscription
    windows used and when each resets, such as "40% · Wed 14:00", or
    "limit · 12:40" when the harness refused work; a window with under 15%
    left is orange. A badge beside each name counts its agents at work, and a
    tower window lights per agent at work (warm for Claude, cool for Codex,
    pale for any other harness; "+N" past eight): Town's working agents, or
    the runs that answered in the last ten minutes where those are more. A
    harness with no reading, including one at work whose budget World cannot
    read (such as Cursor), says "no reading", never 0%; an old reading is dimmed "out of date".
    On a phone it folds to a night-blue sign with a telescope on the town
    center's right wing, such as "Claude 71% Codex 18%". Either sign opens
    **Usage**, a lens over Town with four tabs (Escape, Back, the close
    button or a press outside closes it):
    - **Budget**: each harness's windows with a meter, a line where even use
      would be now and the pace in words: "On track to be used by the
      reset", "Runs out around Thu 09:00, 1 d 5 h before it resets",
      "On pace to leave about 40% unused" (under 80% by the reset), "Too
      early in the window to tell" in its first tenth, or "Limit reached".
      Each card says how many are at work and when and where the reading
      was seen.
    - **Runs at once**: per harness, the most runs going at the same moment
      in each hour of the last 24, stacked into building (worker, fixer) and
      reviewing or checking (reviewer, checker), with the week's busiest
      hour and **Show as table** for the same numbers. A run is going while
      its responses are at most ten minutes apart and while World sees its
      agent working; two short runs at 12:05 and 12:30 are one at once.
    - **Tokens**: the runs answering now and the week's heaviest, each with
      role, item, tokens, calls, largest prompt and context fill; tokens by
      role (with the typical run and calls) and by item or pull request. A
      fixer's second or later round on one item, a context 85% full or a
      run with several times its role's typical calls is flagged in words.
      A run of a harness World reads no log of (Cursor, OpenCode and others)
      shows its time at work and waiting, and "tokens and cost not available
      for this harness".
    - **Breakdown**: the last seven days by **Agent**, **Project**, **Room**
      or **Day**, with time at work, time waiting on you, tokens, cost (the
      harness's reported cost, else "est." from list prices) and pull
      requests opened and merged, and a total row. "unknown" means no
      reading; "(partly read)" means some sources were not readable. Agents
      and rooms no longer open read "Earlier agent" and "Earlier room".
      Under the table, **What World can read** names, per harness at work
      this week, whether its tokens come from its session logs or only
      World's time is known, and whether pull requests could be read.
    Every number comes from [usage analytics](./docs/usage-analytics.md):
    each API response counts once, roles are read from a run's first prompt
    (unknown when it names none), and what the logs do not show says
    "unknown" instead of an estimate. A run's pull request comes from a work
    link its own agent session confirmed, never from its branch alone; a
    branch a pull request has but no confirmed link reads "(pull request
    unknown)". The read refreshes at most every 30
    seconds; after five minutes of failed re-reads the sign says "Usage
    unavailable". For trying rare states, open World with `?usageFixture`
    (two harnesses at work), `?usageFixture=reached` (Claude's 5-hour limit
    reached) or `?usageFixture=empty` (nothing observed); the page drops the
    parameter at once, and only the observatory, Usage and agent cards use
    synthetic runs until the next page load.
  - When reception's queue is full, the rest crowd the lobby beside it in the
    same order, grumbling with a `#@!` bubble; after about 90 seconds a
    grumbler naps on the lobby floor with a `z`. A freed queue spot goes to
    the front of the crowd, and the others move up. Under calm motion the
    crowd stands still, still grumbling or napping. The crowd takes turns:
    one `#@!` bubble per lobby at a time, passing every couple of seconds
    (under calm motion one grumbler keeps it). Zoomed out to the room cards,
    bubbles that would stack thin to one per small patch of screen, the most
    urgent there (blocked, then a question, out of fuel, finished, then the
    crowd); zoom in to see each one. An agent whose state is
    unknown sits at its desk scratching its head under a purple `??` instead
    of dozing.
  - An agent that stopped because its harness hit a subscription or usage
    limit is **out of fuel**: it stays slumped at its own desk, head sunk and
    arms hanging, under an empty red fuel can and a small clock with the
    reset time beside it. Zoomed in, that mark stands in front of the room's
    plate and the seat name tags, so neither hides it. It never
    walks to reception, the bar or the call rail, since there is nothing to
    answer. World reads the stop from the harness's own records, never the
    terminal: Codex's rate-limit snapshot (`rate_limit_reached_type`) or its
    usage-limit error in the session log, and Claude Code's usage-limit
    refusal in its transcript. Its table's card says, for example,
    `Usage limit reached · resets 15:00 (Codex)`, or `Usage limit reached
    (Claude)` when the record has no reset time. Room plaques
    (`1 of 4 agents active: 1 working, 0 waiting on you, 3 out of fuel`), the
    Town board and the Summary's hosts and rooms count out-of-fuel agents on
    their own; they are not active. The state clears by itself once the
    reset time passes or the agent works again.
  - Every building has roads on at least three sides: a street above and below
    each row and a side road to its right. A matching road runs down the left
    of each row's first building, so the town is bounded by roads on both
    sides; its crossings have bus stops like every other.
  - A host entering the town (added in **Manage connections** or ticked in
    **Hosts**) arrives: its neighbours, the roads and the camera make room,
    then its building rises out of its lot in a puff of dust, springs a
    little past its height and settles, its reception and plaques appearing
    as it stands. A host leaving (removed or unticked) stretches up, sinks
    into its lot in dust, and the town closes the gap. Each building rises
    or sinks in under a second, and can be used at once. Several hosts at
    once rise or sink one after another, a moment apart. A building that is
    changed, moved or removed while it rises carries on from its height. A
    host that only disconnects keeps its building, and opening or reloading
    Town shows the buildings already there with no arrival. Reduced motion swaps buildings at once, with no
    movement; calm motion raises no dust.
  - The land around the town is generated: woods with pines, meadows, hedged
    flower gardens and orchards, ponds with reeds, winding footpaths, and each
    street running on beyond the town as a country lane. It fills the whole
    view at every zoom and pan: past the town's own land the woods, meadows,
    gardens and ponds carry on as far as the window shows, with no plain border.
    It is the same on every reload and in every browser, and
    when the town grows only the land next to the change is regenerated. It
    keeps clear of buildings, roads, the town center and its paved apron, bus
    stops and the verge above the first street.
  - The **town center** stands at the top of the town, just across the first
    street from the buildings and centred over their first row: a domed hall
    with a clock, a columned portico, banners and wings, whose front steps
    open straight onto the street's pavement. Buildings stand side by side
    below it with only the normal streets between them. Wide windows open
    Town framed on the billboard above the center and the reception boards
    down to the buildings' street, centred, every board whole, with the park
    below off-screen. Phones open Town with
    it at the top and the first building under it; on a short screen the view keeps
    the building's lounge and shows the center from its plaque down. Tapping it, or its **Town center** plaque (Tab to it, then Enter),
    opens a ring of actions around its doors: **New agent** (World's launcher,
    preselecting the open room when it can start one there), **Town master**
    (the role holder from **Settings → Chimes and who plays them**, else the
    agent named in **Settings → Town master** when nobody holds the role, opened on Chat; a holder not in
    Town says so; with neither set it opens **Sounds**),
    **Needs you** with its count, **Summary**, **Lenses**, **Profiles** and
    **New room** (disabled with the reason when no room can be created). With
    no room open, New room asks for the **Destination host**, herdr-core hosts
    included (`· herdr-core`); an empty core room name becomes "Room". Arrow
    keys, Home and End move around the ring; Escape, a press outside, the
    centre **✕** or **Back** on a phone closes it.
  - **Lenses** colour the whole map by one fact, as strategy games' map
    overlays do, so you see at a glance where it is high or low. Turn one on
    from the town center's **Lenses** or with `L` (`Shift+L` steps back); the
    Town board sign (on a phone, the summary chip) becomes the lens's legend:
    its name (press it to choose a lens), **‹ ›** to step, **✕** to leave, the
    scale, and the reading of the place under the pointer, keyboard focus or
    last tap. Town dims; at home and building zoom each room's floor takes its
    room's colour, with the room's name and short reading at building zoom;
    at room and desk zoom each desk and seated agent carries its own.
    **Idle time** runs from under 5 minutes (warm) to 8 hours and more (cold)
    since each agent last worked; a room shows its coldest quarter.
    **Spend** is today's estimated cost per room and desk (by tokens when
    some usage is unpriced), from the same usage as the expenses boards; a
    host or place without a reading is hatched **No data**, never zero.
    **Pull requests** colours desks with a linked pull request as failing,
    ready, waiting, draft or merged, from the same links as the desk badge;
    a room shows its most urgent. **Quests** shows each agent's quest
    progress; **Harness** shows Claude, Codex, Pi, other agents and plain
    shells, and a room or desk with several harnesses is striped by each
    one's share. Desks and agents with nothing to show stay plain. Screen readers
    hear each place's reading in its name. A lens changes only how Town is
    drawn: taps open what they always do, nothing moves, Escape or **✕**
    returns Town exactly as it was, and Town always opens in **Attention**
    (Town as usual). A search with a lens on outlines its matches over the
    lens's colours, and ending it returns to the lens. The browser remembers
    the last lens for `L` and **Lenses**. With `?scene=town-scale` every lens
    has synthetic data.
    Board offers the same lenses over its cards (see Board below).
  - Each agent has one window: World's Inspector, with one top selector
    (**Chat**, **Terminal**, **Files**, **Changes**, then secondary controls such as **Commits**).
    On phones, a header dropdown shows Chat, Terminal, Files and Changes;
    attention choices move into the window's ellipsis menu.
    Tapping an agent or its table, activating it (double-click,
    **Shift+Enter**), **Chat about this** in Needs you and **Next** open that window on
    **Chat**: the conversation's latest 200 entries, which scroll inside the
    window, with **Jump to latest** when you have scrolled back (counting new
    agent messages until you reach the bottom) and the
    composer always at the bottom. In a window 900px or wider (expanded or
    Zen), the conversation fills the window up to 1440px as rows: who, the
    text (prose wraps at about 110 characters; tables, code and tool steps use
    the whole row) and the time at the right edge, once per run of messages.
    A message typed into the terminal as `name: …` by another live agent in
    the same Herdr session shows as that agent's, marked **relayed**. Narrower
    windows and phones keep bubbles. Explicitly opening or returning to Chat
    focuses its message input when available; Desk previews keep focus in the
    queue. Reopening or redocking the window keeps the
    conversation. A new agent without a session shows **No messages yet**;
    missing or unreadable reported transcripts still show their error. A window
    opens on Terminal whenever Chat cannot show its conversation, including
    when a reported record cannot be read. It switches once Chat is available,
    unless you choose a view by hand. While a new window waits, a line under its
    header says Chat is not available yet and offers **Stay on Terminal**. Unavailable messages appear when you
    pick Chat yourself. Chat describes startup
    or a question plainly and offers Open Terminal; integration guidance waits
    while the agent is starting or waiting for you in Terminal. In Town it
    docks on the right by default (**Settings → Inspector opens**), 520px wide
    (at most half the screen) so Town stays in view and lines stay readable.
    Drag its inner edge to resize it; Town remembers the width. It can be
    undocked, and keeps the dock it was left with. On a phone, the Chat view
    shows only its own composer, without the terminal key bar.
  - In Town, Board and Desk, local source links in Chat open the same
    Inspector's **Files** at the referenced line. Relative links use the selected
    agent worktree; unavailable
    or outside-worktree links offer **Choose a worktree**. Web links stay web links.
    Bare filenames use known source/doc formats with a code, line-number or
    standard-document hint; commands and lists keep individual source links.
    Ordinary dotted prose and unrelated code identifiers stay text.
    Spaces keeps ordinary Markdown navigation without an agent-worktree chooser.
  - An agent's known PR announcement or current work claim can show a compact
    pull request card in Chat. **Details** has CI, reviews and your actions;
    **Ask the author to fix** sends `↳ #N` to the author in this conversation.
    The current quest appears as a collapsed title/progress row in the scrolling
    conversation; expand it for objectives.
    Chat's Now status uses a small circle with a status tooltip and screen-reader
    text: blue working ring, yellow needs-you mark, green done tick, grey idle dot.
    An agent out of fuel has a red dot, and the Now bar reads the same words
    as Town's table card, such as `Usage limit reached · resets 15:00 (Codex)`,
    until the limit resets or the agent works again.
  - Chat reuses Terminal's full **Compose** editor, attachments and harness
    command palette, with a separate conversation draft. Enter adds a line;
    Ctrl+Enter, Cmd+Enter or the paper-plane button sends. Type `/` or use
    **⋮ → Browse commands** for suggestions; the paperclip attaches files.
    Every slash command is allowed and stays **sent,
    not checked** until transcript evidence. Native working-state admission
    shows queued message bubbles with the recipient and time; blocked sends
    preserve the draft and the refusal reason.
  - Claude's questions show from its own record: every question, header,
    option and description, and whether several can be picked. Answer buttons
    appear only when the terminal shows that same question; otherwise the card
    keeps the whole question with **Answer in the Terminal** and the reason.
    An unrecognised prompt is shown as the terminal draws it. Before Claude
    has a session, its folder-trust question shows **No, exit** and **Yes, I
    trust this folder**. With pre-approved grants the decline choice can be
    **No, continue without these permissions**, which continues without those
    grants instead of exiting. Chat and Needs you show the folder, full safety
    text and warnings above the choices. A click is checked against that
    question and Claude process, then moves Claude's selection and presses Enter.
  - Harness command menus, such as Claude Code's and Codex's `/model` and
    `/permissions`, appear as a menu card: numbered options, the cursor, the
    footer's keys as buttons and any text field. Each key is checked against
    that menu and session first; follow-up steps replace the card. **⋮** also
    offers the Terminal's key controls (arrows, Esc, Tab, Enter, Ctrl keys),
    sent to the session Chat shows; paging stays in the Terminal.
    When a qualified row read shows that the terminal is too short to read the
    current session's latest command menu, Chat explains this and offers
    **Open Terminal** to fix its size. Unknown sizes do not produce the note.
  - The top selector follows the window's own width, docked, floating or on a
    phone: labelled from 640px, icons (with their names as tooltips) below
    that, and below 360px only the active view, with the others under ⋯.
  - The Town master's chat (**Settings → Town master**, `firstmate` by default,
    matched against the agent's Herdr name, then its label) opens docked on
    Chat once per visit on wide screens, without moving the pane's focus;
    the town center's **Town master** opens it on demand.
  - Hovering an agent shows a small card as a preview: its latest message from
    Chat's conversation read model, rendered as Chat renders it (never terminal
    text; an unavailable conversation shows Chat's reason), a question when
    recognized and supported answer buttons. It is read-only: **Open chat**
    (or **Follow up** for a finished agent) opens the agent's window on Chat,
    where replies and attachments go. The card refreshes when the conversation
    changes, without polling.
  - Tapping an agent or its table brings the agent back: from reception or the
    bar it walks to its desk and stays there until its status changes. A
    table opens its one pane, else the focused pane, else an agent there
    that needs you (waiting, then finished), else the most recently active
    pane. Only a table with more panes than seats and none focused lists
    them to choose. Herdr TUI and herdr-core
    tables open alike: a live core shell opens its terminal and a core agent
    its Chat or terminal, never a refusal; "World can't mark core work
    reviewed yet" shows only on review controls. **Settings → Opening an agent shows** chooses whether that tap opens
    the chat (the default) or the terminal, in Town, Board and Desk alike; either way the tap does not mark
    finished work reviewed. **Open terminal** in the peek does, as before.
  - A seated agent with a quest (its own todo list, plan, Codex goal or loop)
    shows a blue pennant (green when done, amber when blocked) beside it in
    a room or at a desk, with a progress bar when the quest has steps; the
    pennant leaves with the agent. Hover or tap the pennant for **Quest**, its title and progress.
  - Each agent's context fill reads like a needs bar: how much of its model's
    context window its current session uses (Claude, Codex, Pi and Gemini,
    from their own logs). The peek shows a slim bar and the percent beside the
    agent's status, and the agent's window shows the bar under its icon; hover
    either for the reading, such as "Context 72% · 144k of 200k tokens ·
    claude-opus-4-5". At 85% or more the bar turns red and the agent shows a
    sweat drop at its desk: it is about to compact or lose the thread. An
    agent without a reading, or on a model World does not know, shows no bar
    rather than zero. See [harness usage data](docs/usage.md#context-fill).
  - An agent's peek, and the hover card on its tab or pane row, show its run
    this week: role, item, tokens, calls and largest prompt, such as
    "Fixer · #101 · 12M tokens · 228 calls · largest prompt 176k", with a
    warning line for what may be waste ("fixer round 3 on #101", "context
    86% full"). In the peek the line opens Usage's **Tokens** tab. A pane
    with no run in the read says "This run: usage unknown". An agent of a
    harness World reads no log of shows its time instead, such as "at work
    40 min · tokens and cost not available for this harness".
  - Zoomed into a room, each working agent shows a thought bubble over its
    head with a glyph for the step it runs now: a pencil for editing files,
    a test tube for tests, a prompt for a command, a magnifier for reading or
    searching code, a globe for the web, a light bulb for thinking or
    writing, and two figures for a subagent. A step that has run long for its
    kind (an edit over 3 minutes, a read or fetch over 5, a test run or
    command over 10, a subagent over 20) shows its time in an amber tag. At
    the desk level, or on the selected desk, the bubble adds what the agent
    is doing now and the step with its timer, such as
    `Run the login tests · tests 3m`. The words are the running step's own
    detail (a command's description, the file it edits, the search query),
    else the plan item it marked in progress, else the latest request it was
    given; the terminal title is the last resort, since Claude Code names
    only the session's first topic there. Steps come from the same conversation
    summary as Chat's Now bar, for Claude Code, Codex and Pi; another harness,
    or a tool Town does not know, keeps the typing dots. Town reads steps only
    for working agents on screen at the room or desk level, when the service
    reports their conversation changed, at most 32 per read and one read at a
    time per connection; nothing is polled.
    Bubbles do not move, and hovering the agent still opens its peek.
  - **Open terminal** in the card's header opens the live pane; **Open chat**
    opens the agent's window, whose Files and Changes views hold the rest.
    **Next** opens the next waiting agent's window,
    then finished agents' if none wait.
    **Mark reviewed** in the peek marks the report it shows: it waits while a
    newer stop's report is read, offers **Retry** when that read fails, and
    says so when the mark could not be saved.
    Review marks acknowledge a specific completion in the service's one
    reviewed record, shared by Town, Desk, Needs you and every browser of this
    World, without certifying its correctness. They survive a World restart
    and reappear after the same terminal and known session are verified.
    Upgrading old separate completion checks preserves proven known-session
    reviews; work without session proof may need review once again. Missing Desk
    stop metadata is refreshed before marking, and an unavailable stop stays retryable.
  - **+**, **−** and **ALL** navigate between town, building, room and desk
    detail. Drag to pan; focused arrow keys pan too. Tap a room to zoom in.
    Phones stack buildings vertically; large towns can initially show roofs.
    **Town calm motion** reduces ambient animation.
  - Light is Town's status language. The sky button under **ALL** opens a
    small **Sky** panel. **Time of day** is **Your clock** (follows this
    device's time), **Day**, **Dusk** or **Night**. **Weather** is **Real
    weather** (the default; it follows the [Weather source](#weather-source)
    and shows its current reading, such as `Rain 7° · Example City`, or why
    there is none), one held condition (**Clear**, **Cloud**, **Rain**,
    **Snow**, **Fog**, **Storm** or **Wind**), or **No weather**. The panel
    holds no place or source settings of its own: **Weather place and
    source…** opens that row in Settings (Integrations → Sources → Weather).
    Each browser keeps both choices; the button shows the weather Town is
    showing, or the time of day when there is none. As the sky
    darkens, light follows where agents are: a room is lit while an agent
    sits at a desk there working (or waiting on you at it) and is dark
    otherwise; each desk throws its seated agent's state colour (blue-white
    working, amber waiting on you, green done); the bar is lit while anyone
    is at it; and street lamps light the roads. Light changes with the walk:
    a desk and its room light when the agent sits down, and go dark as it
    stands up for the bar or reception. An agent with no status report sits
    at its desk unlit. A reception whose building has someone waiting on you
    pulses amber over its lobby by day and by night; under calm motion or
    reduced motion the pulse holds as a steady mark. An agent or terminal with
    an open question for you counts as waiting on you whatever its runtime
    status; a terminal with no agent throws amber from its desk. A failed
    host's cached building stays dark. Day leaves the town as painted.
  - Town's overlays share one style: the Town board (and its phone chips),
    the zoom and sky buttons, the Sky panel, an agent's peek, toasts, and the hover
    cards of rooms, tables and fuel gauges are the same translucent dark
    panel, with one border, corner, shadow, type and spacing in World's light
    and dark themes, readable over a white roof or the night. Their titles,
    borders, buttons and focus rings are neutral. Amber in them marks only
    what needs you: a **Waiting** count above zero, a waiting agent's peek,
    the first answer to an agent's question and a **low** fuel gauge. The
    sky button keeps one neutral colour at dusk and night.
  - The time of day also gives the town depth. By day each building casts a
    sun shadow that swings from left in the morning to right in the evening,
    short at noon and long toward dawn and dusk, and faint cloud shadows drift
    east across the land. At night street lamps glow at their heads and
    fireflies wander over open grass away from buildings. It stays quiet:
    shadows and clouds lie on the ground under the buildings, so they never
    shade a room, a desk or a status mark, and the status light and amber
    waiting pulse stay above it all. Under calm motion or reduced motion
    nothing drifts: clouds and fireflies hold still. While they drift, Town
    redraws only as often as they move a screen pixel, at most 12 times a
    second. Rugs are woven with a bound edge, and room walls shade the floor
    along their foot.
  - Weather follows the same rules. Clouds thicken and dim the sun; rain
    falls at a slant with a wet street and puddles on roads and the plaza;
    snow falls slowly and lies on the ground; fog veils the land in drifting
    banks; wind speeds the clouds and blows streaks across the town; a
    storm adds heavy rain, a dark sky and a soft, rare lightning flash. Light
    real weather still shows clearly, and a held condition shows at moderate
    strength. Rain, snow and wind streaks fall over the whole visible map,
    buildings and trees included, at every zoom and scroll position; wet and
    snowy ground and fog lie under the buildings and cover all the land on
    screen, the forest around the town included, with no edge. Status light stays above
    the weather, and dark weather lights rooms, desk colours and lamps as
    dusk would, so lit rooms, desk colours, the amber reception pulse and the
    post office read in a storm. Rain, snow and wind streaks keep the same
    density on screen at every zoom, with a fixed cap (a phone shows a little
    more than its share so it never looks patchy), and redraw at most 20
    times a second (snow 12). Under calm motion or reduced motion nothing falls or flashes:
    the street stays wet, snow lies, fog and cloud hold still, and nothing
    redraws for the weather. With **No weather**, or when real weather is
    off, unavailable or expired, Town looks exactly as it does without
    weather.
  - Zoomed into a room or desk, every agent that needs you outside the view
    gets an arrow on the view's edge pointing at it, with its mark (**!**,
    **?** or **✓**); arrows pointing the same way or at one building merge
    with a count, such as `! 3`. Click or tap one and the camera glides there
    and the agent's mark pulses (under calm or reduced motion it jumps, with
    no pulse). On a desktop, **N** moves the camera to the next thing that
    needs you in Needs you's order and opens Needs you at it, with a brief
    "2 of 7 · N next"; **Shift+N** goes back, and after you answer one, **N**
    goes on from there. Both keys are Town actions in Keyboard shortcuts and
    stay silent while you type. Neither answers, reviews or moves anything.
  - Room actions support
    workspace/tab creation and room management on the captured host. Every
    building has a **+ Add room** doorway just left of its bar (just **+** at
    the room-card zoom), which stays put when rooms open, close, move or are
    tidied. It opens New room on that building's host, and the new room
    appears where rooms normally go. For keyboards and screen readers it is a
    button named "Add room to <host>". Room
    plates fit their room width; only the name truncates, with its full text in
    a tooltip. Colour, active/total agent count and blocked badge remain visible.
    Active means working or waiting on you; the total excludes plain terminals.
    Hover the count for its working/waiting breakdown. Hover or focus a plate
    (tap on touch screens) for its card below it: the Town board's numbers
    for that room, without its agents list (Busy, Waiting, Done, Quiet,
    its agents, and its **Economy today**: estimated cost, tokens and models
    from [harness usage](./docs/usage.md); without a price table it says
    "no price table" instead of a cost, and a host whose logs cannot be read
    says "No usage data from this host"), then Rename and Close with 40px
    targets. A
    table, or its nameplate, opens the same card for that table on hover,
    focus or a tap; a click on the plate selects the table and a double click
    opens it. On touch screens one tap opens a live table's default pane; on
    a table with nothing to open at once (a cached host's, or a crowded one)
    the first tap opens its card and a second tap (or a double tap) does what
    a tap does. Zoomed out to the room
    cards, each room's card is a slim label hanging from its rug's top edge:
    its name, a waiting badge and a thin bar of working, waiting, done and
    quiet; hovering or focusing it adds the count line. A mouse anywhere over
    a room shows the same room numbers under its label.
  - Drag a table onto another room of the same host, or an agent onto another
    table, to move it (hold, then drag on phones; **M** on a focused table or
    agent from the keyboard). Tables lift from the room-summary zoom in, even
    under a room summary, whose tap still zooms in; agents lift once zoomed
    into a room. A carried table lifts and sways after the
    pointer, lands with a bounce and a puff of dust, and shakes and springs
    back when a move is refused; calm and reduced motion keep it under the
    pointer and end with a short fade. The live panes move, agents keep running, a failed
    move attempts rollback and reports partial or unknown results. Moving a
    room's last table asks first because the room closes. When a table closes, the tables after it close up.
  - Tables sit in Herdr's tab order, left to right and row by row, so moving a
    tab in Spaces or Herdr moves its table. Drag a table onto another table in
    its room to put it in that place, or onto the room's free spot to put it
    last of the tables shown (**M** lists the same places). Rooms extend as
    tabs open: wide screens show three columns of rooms up to eight tables
    wide, portrait and half-width screens two columns up to six, and phones
    three columns up to four, growing downward, so a phone opens on compact
    room cards spread across each building rather than one long column. A folded room normally shows up to
    24 tables: pinned desks first, then the first tabs in the same order as
    Spaces, without promoting later working or recent tabs into that prefix. The bottom-right
    **» +N** tile sits beside the dashed **+** seat and counts hidden tables.
    Each click appends the next 20 tables until all are shown; **Fold** is
    available after the first expansion and returns to the first 24 in one click.
    A red **!** in the tile's top-left marks hidden desks that need you; a green
    **✓** in its top-right marks hidden unreviewed completions. These icons clear
    as desks are revealed or their attention is resolved. Plaques count all
    agents, including hidden desks. A growing room moves
    only the rooms below it, and never
    while you hold the town. Town asks Herdr to move the tab and
    shows the new order when Herdr reports it; agents stay with their table.
  - **Teams.** Tables whose agents know each other are drawn inside one wall
    with a connector: a spawned agent is joined to the agent that started it,
    and a manual group with dotted lines; stale links are faded while a host
    is offline, and dropped once its agents have closed. A team's tables that
    touch share one wall, which bends around another team's table rather than
    splitting; separate clusters of one team get a wall each, joined by a
    connector.
    Drag a table onto another table and hold it there a moment: it snaps to
    that table (**Group with …**), and dropping groups them. Town moves it to
    that room if needed and seats it in a free place touching the other
    table, on the side it came from where it can; no other table moves, and
    Herdr's tab order stays as it was. The tables keep those places until the
    room's tab order changes or the page reloads. A quick drop keeps meaning
    a move or a reorder, so the gestures stay separate.
    Drop a table you grouped on its own room's bare floor (not the free spot)
    to leave its group; a spawn link stays, since Herdr's stamp records it.
    **M** on a focused table offers the same as **Group with…** and **Leave
    the team**, and the table's accessible name lists its teammates. A
    pinned table joins a team only in its own room, and keeps its pinned seat.
  - **Pin a desk** from the first item in its mobile agent window's **⋯** menu
    (**Pin desk in Town**), or from the desktop window’s **⋯** menu. Pinned
    goes first, as in Herdr's apps: a room's pinned desks take its first
    seats, in tab order among themselves until you reorder them, and the
    other tables follow in tab order; unpinning returns a desk to its
    tab-order seat. Pinned desks reorder on the rug, as pinned browser tabs
    do: drag a pinned desk (mouse or touch) onto another pinned desk of its
    room and it takes that desk's place, or press **M** on a focused pinned
    table and choose a pinned desk's place. Dropped anywhere else (off the
    rug, on an unpinned desk, in another room) it glides back to its seat;
    while you drag, the hint says **Unpin to move it out of the front row**.
    A drag never unpins it, and an unpinned desk cannot take a pinned seat.
    The order is a World view setting saved with the pin (for a core agent,
    beside its shared pin, since Herdr's apps have no order for pins), so
    every device and a reload keep it; Herdr's tab order is unchanged. A desk
    pinned later, here or in a Herdr app, joins the end of the rug; unpinned
    and pinned again, it starts at the end. A folded room always shows its
    pinned desks. The room's pinned seats share one floor rug, a pale woven
    carpet with fringed ends drawn under them as one piece, so the group
    reads at a glance (a room with no pins has none); like the floor, it
    shows wherever the room's interior does. Each pinned desk also carries a
    small quiet pin on its front-left corner, a corner the goal pennant,
    status marks and name never use; neither the pin nor the rug wears an
    attention colour. A desk holds a tab, so a desk with several agents is
    pinned while any of them is. Its agents stay at it:
    they never go to the bar, leave only to wait at reception (blocked, or
    finished and not yet seen) and walk straight back once you have seen them.
    For Herdr TUI agents, the pin stays in World; core pins are shared
    with Herdr apps. Spaces' tab pins (close protection in this browser)
    are separate. A pin
    follows its tab when the tab moves to another room and goes when it closes.
  - **Move rooms.** Drag a room anywhere in its building by the **Move**
    handle in its plaque's card (next to Rename and Close), by its name
    plaque (or its name on the zoomed-out room card) or by its wall. It moves
    with all its tables and agents and stays where you drop it, in whole
    tiles inside the building's walls; rooms in its way move down, and the
    building grows or shrinks to fit. A green outline shows where it will
    stand and pale outlines where the others go. Letting go on its own spot,
    or pressing Escape, returns it. On a phone, drag the Move handle, or touch
    and hold the name or wall, then drag. The card's **Move before …** and
    **Move after …** arrows swap the room with its neighbour, for the
    keyboard. Rooms stay in their own host's building. World saves where the
    rooms stand with the Board layout (like pinned desks), so a reload and
    every device show the same arrangement, and puts Herdr's workspace order
    in reading order (top to bottom, left to right), so Spaces lists the
    rooms as Town shows them. A building whose rooms were never moved still
    stacks them in Herdr's order.
  - **Tidy rooms.** **Tidy rooms** (sparkles) on a building's sign, or the
    sparkles button on its reception board (next to its colour), puts every
    room of that building back in order in one step: in Herdr's workspace
    order, each room joins the shortest of the building's columns, two tiles
    apart, with no gaps or overlaps, exactly as a building whose rooms were
    never moved stacks them. The rooms glide to
    their new spots (or simply stand there under calm or reduced motion), and
    World saves the result like a room move, so it stays after a reload and
    Spaces keeps the same order. Tidying a tidy building changes nothing.
    **Undo** in the note that follows (for five seconds) puts the rooms back
    where they stood. Rooms still move freely afterwards.
  - **Bin and bus.** Dragging an agent (or a desk) onto the bin icon at the
    bottom of Town or Board, or onto a Town bus stop, or **Put in bin** in an
    agent window's **⋯** menu (from Town, Board or Desk) holds the agent;
    nothing closes yet. In Town it walks out of its building's front door to
    the London bus stop (red roundel) nearest its room, the same character
    walking as it does indoors, whether it was dropped on the bin or a stop
    (one binned on Board walks out the first time Town shows it); its seat
    fades into the carpet and crumbles, the whole desk when all its agents
    are binned;
    those waiting at a stop queue along its pavement in joining order, in
    two rows when long, with a **+N** board at the end for any more; one put
    back walks home from the queue and those behind step up;
    there is a stop at every road crossing, the leftmost included (crossings a
    step or two apart on one street share one); its sign
    is street furniture like the lamps, drawn behind buildings and agents and
    under labels and panels, and shrinking with the town as it zooms out (on
    a phone zoomed far out, the floating bin is the easier target). A
    countdown board over those
    waiting shows the bin's own countdown, from the one bus timetable: the
    time until the next bus sets off from Apartments, **on its way** while a
    trip is out and **stopped** while it stands. Every stop and the bin read
    the same value at the same moment. The bin floats at the bottom of the screen and
    lights up during a drag, so a phone needs only a short drag, and the town
    does not scroll while the drag rests on it. A red
    double-decker lives at Apartments' stop, on the last street by a
    footpath down to the building's door (its green house sign marks it),
    and sets off every four minutes on a fixed schedule when someone is
    waiting. It drives only the town's roads, by the nearest way round the
    stops with riders and back, never off the map: it turns its corners,
    slows to each stop and waits there about ten seconds with its door open
    while its riders step on, and its riders show in its windows the whole
    way (in its side windows, or its front and back windows on a road up
    or down the screen). Back at
    Apartments it opens its door, its riders step off one by one and walk in,
    and the sign counts each as it goes in; the last is in just as the trip
    ends, which is when their agents close. Where the town is too small for
    the building, the bus stops at the town center's door instead, which
    opens Apartments. Agents put in the bin while
    the bus is out wait for the next one. Tapping the bus stops it where it
    is and opens the tray (nothing closes while it stands); **Let the bus
    go**, or closing the tray, sends it on. The bin (always shown in Town and on Board, in other views while
    it holds agents; on a phone, also a stop or the bus in Town) opens the
    tray: who waits, the time to the next bus, **Put back** (until the trip
    ends, even after boarding; it walks back to its desk from its stop) and
    **Close now**. A pinned desk's or pinned tab's last agent cannot go
    in the bin, and its close never takes a pinned tab's last pane. Closes are qualified by host
    and runtime: a host that restarts keeps its agents, and restarting World
    drops the bin without closing anything. Only Town speaks of the bus:
    elsewhere the bin reads **Cleaning up** and how many, and its tray says
    when they close. Closed agents move into
    [Apartments](#apartments-finished-agents).
  - Cached failed-host buildings, agents and Board cards stay stale and
    non-actionable. **Disconnected · Reconnect** appears on Town's building and
    reception and Board's host label. A live herdr-core host is never stale
    there: Board offers its **+** (New workspace) instead. When the local connection is failing and
    no host is ready, Town's stage also offers to set up a runtime. With no
    runtime installed it offers **Set up herdr-core** first and **Use the Herdr
    TUI instead** second; with Herdr installed but stopped it offers to start
    Herdr. **Set up herdr-core** shows the version, where core goes
    (`~/.local/bin/herdr-core`; on Windows
    `%LOCALAPPDATA%\Programs\herdr-core`), that it is checksum-verified and starts at
    login, then **Install and start** runs it on this computer only, with
    progress and plain errors (**Try again**). Nothing installs or starts
    before you confirm, and the card never appears during a normal start or
    after you disconnect. Once core connects, the card goes away.
    Transient local socket failures and SSH outages keep retrying with
    capped backoff; explicit disconnect/removal and permanent failures stop
    recovery. Cached work never becomes current until a fresh runtime snapshot
    is admitted. Search and Hosts
    use the shared aggregate. Reception and bar positions only show status;
    only an explicit move changes Herdr's layout, always within one host.
    Terminal title-spinner and scroll repaints keep healthy hosts actionable;
    topology or agent-state changes still require a fresh observation.
  - **Search shows where things are.** Town's search hangs from the top
    edge beside the view buttons in Zen, World's default, and sits in the top
    bar when the bars are shown; on a phone in Zen it is the search button in
    the bottom-right corner. On a desktop the search of Town, Board and Desk
    rests as a search icon whose tooltip names its keys; a click unfolds the
    search box with the cursor in it. **Escape**, or leaving an empty box,
    folds it back into the icon; a query keeps it open. Typing in Town's search lights up the
    matching buildings, rooms, tables and agents on the map and dims the rest
    of Town a little; the camera stays put. The result line counts matches and
    how many are off-screen ("7 matches · 3 off-screen"). Choosing a result (a
    click or tap, or **Up**/**Down** then **Enter**) moves the camera to it at
    a readable zoom and pulses it; choosing it again, or **Enter** a second
    time, opens it as selecting does. Town's own places are found too:
    "warehouse" (or "pull requests") lists the **Warehouse**, and choosing it
    moves the camera there; choosing it again only shows it again. A result Town does not draw, such as
    an agent at a table its room folds away, opens at once and counts as
    off-screen. Under **Town calm motion** or reduced motion the camera jumps
    and nothing pulses. **Escape** (in the box, on a result or on the map),
    the phone search's **✕** or an empty box ends the search and returns the
    camera to where the search found it. **/** or **Ctrl+F** (**Cmd+F** on a
    Mac) unfolds the search of Town, Board or Desk with the cursor in it, or
    opens the phone's search, unless you are typing in a terminal, the Chat composer or
    another text field; the browser's own find stays closed. Change the keys
    under **Search the current view** in Settings → Shortcuts.
  See the [Town exercise](./docs/TUTORIAL.md#town).
- **herdr-core first on a fresh install.** A fresh standalone install and the
  Homebrew launcher keep any installed runtime (`hc`/`herdr-core` or `herdr`)
  with its existing version and owner, and install nothing. When neither is
  found they install herdr-core: its release list over HTTPS (a dropped connection is
  retried up to three times; an HTTP error fails at once), the archive for
  this computer checked against its SHA-256 (nothing downloaded runs as a
  script; on macOS a release without the signed Herdr Core.app is refused
  before anything in it runs), `~/.local/bin/herdr-core` plus an `hc` link if
  free, then core starts now and at login (a systemd user unit or a launchd
  LaunchAgent) and World
  gets a `core-local` connection as its default. Homebrew does this on first normal local World
  launch. A World too old to add the connection, or one already serving, says
  to add it under **Hosts → Manage connections**. With npm,
  `herdr-world herdr upgrade --install` does the same when no runtime exists
  (`--json` prints `{"runtime":"herdr-core",...}`), and `herdr-world herdr
  setup` with no Herdr keeps an installed herdr-core (starting it now and at
  login) or installs one; neither ever installs Herdr beside a core. Windows x64
  works the same way with core's own PowerShell steps (System32 `curl.exe` and
  `tar.exe`, the zip checked against its SHA-256, nothing downloaded run as a
  script): `%LOCALAPPDATA%\Programs\herdr-core\herdr-core.exe` plus an `hc.exe`
  link if free, added to your user PATH, then core starts now and at login (a
  shortcut in your Startup folder that World rewrites only if it wrote it).
  World connects to a core on the same Windows computer over its named pipe,
  read from `core.lock` and opened existing-only, as for Windows SSH hosts.
  Windows on Arm has no core build, so there setup stops with "herdr-core has
  no build for this computer". `HERDR_WORLD_SKIP_HERDR=1` skips all of this.
  Explicit runtime upgrades remain available.
  For a preview without core installed, open `?coreFixture=first-run`, then
  **Hosts → Manage connections → Start fixture core**. The success message confirms
  that production discovery saved `core-local` in isolated fresh state; close
  Manage connections to see the synthetic agents in Town. The parameter disappears
  immediately. This fixture does not exercise the operating system's login manager.
- **Finish installer upgrades.** Replacing an existing standalone World executable
  upgrades Herdr and refreshes detected harness integrations and the installed
  World plugin through the same path as `herdr-world update`, then restarts the
  matching running systemd or launchd World service. Output reports the Herdr
  and integration results (updated or current) and whether the service restarted
  or why it did not.
  `HERDR_WORLD_SKIP_HERDR=1` skips Herdr and its integration/plugin changes while
  keeping the World restart. `herdr-world rollback` restores the previous World
  binary, leaving Herdr and integrations as they are.
- **Per-host Herdr identity.** **Manage connections → Check version again**
  reads the selected card's running server version and protocol. Compatibility
  expires after one minute; failed or disconnected checks remain unknown.
  The installed binary is separate and unknown. Upgrade is explicitly unavailable
  until its target and safe handoff are verified; no remote update runs.
- **New agent and agent profiles.** **New agent** starts an agent in a new
  tab of a room you choose, from a profile (one tap) or from any agent kind the
  host's Herdr supports. It is in the Actions menu of Town and Board, on Board's hub (**+**
  beside the bin), on each
  Town room's dashed **+** seat (zoom into the room first), beside **+** in
  Spaces' tab bar,
  and in Board's New tab dialog. The room seat preselects its room; the
  launcher's first choice, **Terminal**, creates a plain shell tab. World
  creates an agent's tab, starts the harness
  through Herdr, waits until it is ready, then sends the first prompt; if the
  harness stops on a question (such as Claude's folder trust) or exits at
  once, it says so and offers to open the tab. While a start is in flight, the
  pressed choice stays marked busy and a **Starting …** line says what World is
  doing; after 10 seconds of real waiting it reads **Taking longer than
  usual** (there is no progress bar or countdown, and the icon stays still
  with reduced motion). Progress and outcomes stay in view above the choices.
  When World confirms the start, Town plays the new agent's **arrival**: it
  steps out at the town center (when started from the town center's **New
  agent**) or at the bus stop nearest its room (started anywhere else), walks
  the streets to its building's front door, goes in to its desk and sits
  down, and a sparkle and its name fade over it. The walk outdoors takes at
  most 3 seconds and the walk in at most 2.5; several starts at once arrive
  0.7 seconds apart. Agents already in Town, a reload, a failed or uncertain
  start and returning to Town never play it. With reduced motion the agent is
  at its desk at once with a still highlight that fades. A confirmed start closes the launcher and opens
  the new agent's or terminal's window once World shows it, on Herdr TUI and herdr-core hosts alike, even when Hosts hides that host; an uncertain
  attempt keeps its explanation and disables start choices. Open its existing
  tab or close the launcher before another attempt. A definite failure lets
  you retry, log in or edit profiles.
  - The launcher shows whether each harness is installed and logged in on the
    host, asked with the harness's own status command (`claude auth status`,
    `codex login status`; Pi reports only whether it is installed). **Log in**
    opens a small tab and shows the harness's own login command to copy and
    run there. World never types into it, and never sees or stores
    credentials. Failed or unreadable probes remain unknown, with the safe
    check source/time, **Check again** and existing **Edit profiles** controls;
    only confirmed absence blocks a supported harness. Windows probes remain
    unsupported. See [readiness evidence](./docs/harness-readiness.md).
  - **Agent profiles** (Settings → Agent profiles, Actions → Agent profiles, or
    Edit profiles in the launcher and Board) set a name, home room, role,
    colour, brain (harness, model, Codex reasoning effort, permission mode),
    skills (the room's and host's `SKILL.md` folders), tools, a starting brief
    with `{{name}}`, `{{task}}`, `{{room}}` and `{{spawned_by}}`, and a Town
    look: skin, hair, outfit (including a dress or a captain's jacket),
    colours and an accessory, with a live preview. Reviewer, Builder,
    Designer and FirstMate are starters you can edit or delete.
  - At launch a profile becomes the harness's own configuration: Claude Code
    gets an inline subagent definition (`--agents` and `--agent`, the fields of
    `.claude/agents/*.md`) and `--permission-mode`; Codex gets `-m`, `-a`,
    `-s` and `-c` options with the role as developer instructions; other kinds
    start plainly and get the role in their first prompt. The editor shows the
    exact command. The new tab takes the profile's colour and its agent wears
    the profile's look in Town.
  - Profile assignments and the Town master travel with their terminal in Herdr
    and are shared by Worlds connected to that Herdr. Profiles and chimes stay
    per World; an unknown profile shows its recorded name with the default look.
    Closing the terminal or restarting Herdr ends its assignment and role.
    The newest Town master assignment wins; moving the role still asks first.
  See the [New agent exercise](./docs/TUTORIAL.md#new-agent).
- **Shared terminal appearance.** The title-bar icon opens the same editor in
  every view, including the Spaces tab strip and arranged window headers; a
  phone has the appearance button in its terminal app bar. The
  header shows the native Herdr tab name, with **Save name** calling its current
  connection's `tab.rename`. Tab colour and a 160-character manual status are
  shared across split panes; each pane can choose an existing bounded sprite
  avatar. Board shows icon/status, Town shows the character/desk callout, Spaces
  shows icon/status tooltip and Desk shows the same choices. Resets restore
  existing defaults, and failed saves preserve their drafts. Workspace icons
  and status messages are outside these controls. Complete current observations
  reclaim settings for closed terminals; unavailable hosts retain their settings.
  Runtime status badges retain
  their system colours and meanings.
- **Terminal colours.** Every tab has one colour, shown as the tab in Spaces,
  the card in Board and its table in Town (tabs beyond a room's drawn tables
  show it in Spaces and Board). Colour is quiet identity, never attention: the
  palette's eight tones are muted and equally light, so only status (the agent
  marks, each with its own glyph) uses loud colour. A tab without a colour of
  its own shows its room's: the workspace's chosen colour, or else the room's
  stable default, so a room reads as one colour and only rooms differ by
  default. Choose another from the terminal's icon in its
  window header or the appearance button in the phone terminal's app bar, the
  terminal window's menu (**Colour**), the tab's menu in Spaces, the swatch in
  an agent's peek in Town, or the selected card in Board, and reset a tab's own
  colour with **Default colour** the same way. Herdr has no tab colour, so the World service
  saves the choice by immutable connection and Herdr tab ID, with terminal-ID
  continuity evidence after migration. A reused tab ID cannot inherit a bound
  choice. Legacy colours acquire their initial evidence from complete current
  observation; their earlier identity cannot be reconstructed. A closed tab's
  saved colour is dropped.
  - Workspaces and hosts have colours too. A workspace's colour is its Town
    room's carpet (swatch beside the room's name), its Board card and a dot in
    the Spaces sidebar (its menu offers the palette); its tabs without a colour
    of their own take it. A host's colour is its Town building's roof (swatch on
    its reception board), its Board zone (swatch on the zone label) and its
    Spaces header; it is not passed on to tabs. **Default colour** returns a
    place to its own default.
  - A desk moved to another room keeps a colour picked for it. Without one it
    takes its new room's colour, like every desk there.
  - A spawned agent's tab without a colour of its own takes the colour of the
    tab that spawned it (before its workspace's colour), and keeps following it
    when moved. A chosen colour always wins.
  - The existing agent CLI colour command binds the current tab occupant too.
    Undo compares that binding as well as its colour. An older undo that cannot
    establish continuity is refused; set the desired colour explicitly instead.
- **Agent interest.** The button beside an agent's name in its Inspector
  header in Town, Board and Spaces (or **⋯ → Attention** in mobile windows) sets **Default (from groups)**, explicit
  **Watch**, **Muted** or **Focused**, saved by the World service for its terminal on
  every device. Chimes
  read it: a muted agent never chimes, and while a focused agent is reachable
  only focused agents and the Town master's needs-you chime (Watching then
  says it is quiet). A focus on an offline host silences no one until the host
  is back. Interest never hides
  anything from reception. An explicit agent choice wins; otherwise Group Focus
  beats Group Mute, with Default contributing no claim. Focus combines currently
  reachable effective-focused agents and Group members. Hover explains the source
  and any overridden group claim. Team/Pod controls live in Groups; v1 hides them
  on Room/Desk. Group preferences survive away members and are removed atomically
  with deletion. Individual interest follows the terminal through moves, and goes
  when its host shows the terminal has closed, including after reconnecting.
  A failed save shows an error and keeps the previous choice; reopen the
  button to retry.

- **Board** (`/board`) shows hosts as zones, workspaces as cards and tabs as
  cards around their workspace, beside your notes. Cards are elastic while you
  move them (on phones, hold a card still before dragging it; a quick swipe
  pans the board, as in Town) and settle within a second; workspaces fold into a count and open
  into free space; Tidy (with Undo) rearranges a workspace or the board and
  carries strung notes along. Zoomed out, workspaces show a square per pane.
  - **Town's facts on Board.** Board reads the same read models as Town, so
    each number matches Town's for the same thing. The chip at the top left
    counts **Busy**, **Waiting** (including open questions), **Done** (finished
    and not yet reviewed) and **Quiet** agents across all hosts; tap it for the
    **Board summary**: those counts with the number of agents and hosts,
    expenses today and over 7 days (UTC, estimated from harness logs, with
    what the totals leave out), each harness's limits with the reading's age,
    the finished work not yet reviewed (each with its room, host and last
    activity; tap one to show it on the board) and each host's counts,
    expenses and limits. Escape or the chip closes it. Each host zone's label
    is a heading with the host's name and agent counts, then short lines
    under it: expenses today and over 7 days, and each harness's limits on
    its own line; each workspace card shows its usage today and over 7 days, as Town's room
    card does. A single agent's tab card ends its line with what the agent is
    doing now, and a pane row shows it as its state: the running step and its
    time (amber once it has run long, as Town's thought bubbles), **Not
    reviewed** or **Reviewed** for a finish, or **Idle** and how long. Board
    reads steps only for working agents on tab cards it draws; nothing moves.
    Town and Board share one record of finishes, so an agent that finished
    while Town was open is still a finish when you switch to Board, and the
    other way round.
  - **Board's hub** stands beside the bin at the bottom centre and offers the
    town center's actions as compact buttons: **+** opens World's launcher
    (preselecting the selected card's workspace when it can start one there,
    and the new agent's card appears on Board), the crown opens the **Town
    master**'s Chat (found as the town center finds it) and **⋯** lists
    **New agent**, **Town master**, **Needs you**, **Summary** (which takes
    you to Town with the Town summary open), **Profiles** and **New
    workspace** (disabled with the reason when no host is ready) in a plain
    menu. Arrow keys, Home and End move through the menu; Escape, a press
    outside or **Back** on a phone closes it. Board's controls leave the hub
    and bin room on their row, folding into Board's **⋯** menu as needed.
    The bin itself works as before.
  - **Lenses**, **Since you left** and pull request badges work on Board as
    in Town, from the same facts. **Lenses** in Board's controls (in its
    **⋯** menu when the row is short of room, as on a phone) or `L`
    (`Shift+L` back) opens Town's legend at Board's top left: each workspace
    card takes its room's reading, each tab card its desk's and each agent's
    pane row its agent's, on a tag along the card's top edge and in its
    outline; cards with nothing to show step back. Hover, focus or tap a
    card to read it in the legend; Escape or **✕** leaves the lens, and the
    browser remembers the last lens for Town and Board alike. After a return
    of 30 minutes or more, the same **Since you left** recap as Town's board
    sign stands at Board's top left. A tab whose agent has a linked pull
    request or ticket shows Town's desk badge (`#123 ✓`, `#123 ✗`, `#123 ●`
    or `ABC-12`) beside its name; for one of your open pull requests, tap it
    for the pull request card. With `?scene=town-scale` the lenses and badges
    have synthetic data, and `?awaySince=120` pretends you left two hours ago.
  - **Next** cycles waiting agents and shared questions placed on their panes,
    including shell questions, while skipping stale hosts and shells without
    questions. It stays reachable in the Board menu when the controls need more space.
  - The Board **⋯** menu offers **Surface** (Follow theme, Whiteboard or
    Blackboard), **Status colours…** and **Help** (Board's help entries, each
    with **Try**). Surface and status choices
    persist in this browser and stay separate from shared card colours;
    **Reset status colours** restores the chosen surface's defaults.
    Following a dark theme, Board takes Town's night: its ground, its agent
    state colours (blue working, amber waiting on you, green done) and its
    sign lettering on host and workspace names, and a workspace waiting on
    you glows amber as Town's reception does. A light theme or Whiteboard
    shows the whiteboard; Blackboard keeps its green chalk palette.
  - Drag a pane row or the grip on a single-pane tab onto another tab on the
    same host to move only that pane, or hold the row or grip first on a phone.
    The move keeps its terminal running and its strings attached; cancelling sends nothing. Moving the
    old room's last pane asks before closing that room.
  - Tapping or double-clicking a tab or pane row opens an agent on Chat (as in
    Town, by **Agents open**), and a plain shell, or an agent without Chat, on
    its terminal. Without a conversation yet, an agent starts on Terminal and
    switches to Chat when its session arrives unless you choose another view.
  - **Pin** in a selected card's bar puts the card first: a workspace's
    pinned tab cards sit directly above it, in tab order, in rows of up to
    three, on one tinted band, and follow it when it moves. Tidy and
    placement keep them there and clear other cards off the band; a pinned
    card dragged away glides back. **Unpin** returns the card to free space
    beside its workspace. A pinned workspace card keeps its place on the
    board. Bands hide in the zoomed-out overview. On a phone, where the
    card's terminal covers Board, the pin in the terminal's header pins its
    card. Pins are saved with the board on the World service.
  - Tabs list each pane as a row; plain-shell tabs look like terminals; only a
    working agent's tab (or the selected one) pulses (a ⋯ setting).
  - An agent with a quest shows a ⚑ chip with its progress (such as 2/5, or
    Loop ×3); hover it for the quest and the current step.
  - **+** on a workspace opens New tab (Terminal, one of your agent profiles,
    or any agent kind the host's Herdr supports, an optional name, then
    Create; a note's Start an agent uses the same dialog, and **Edit profiles**
    opens the profile editor); **+** on a host creates a workspace. Workspace cards count their
    agents by status; tabs show their terminal colour and workspaces take a
    colour the user picks, while status keeps its own colours.
  - Notes and strings are saved by the World service and shared across your
    devices. Strings attach to an exact pane, tab or workspace; a note strung to
    a pane is sent to its agent only when you press Send. When you make the
    string, World records the agent you saw in the pane, once it confirms that
    agent (by its Herdr session) is still there; otherwise the first Send asks. Send checks the runtime, the witnessed
    pane and terminal, and that agent. If another agent now holds the pane,
    even in the same terminal, nothing is sent: World names the new agent and
    sends to it only if you choose **Send to** it. World also asks again if
    Herdr stops reporting a previously captured session, even when the pane
    and terminal stay the same, without claiming a known replacement. An
    explicit **Send to** choice selects the recipient for that attempt; it
    cannot fall back to the original agent if that agent returns.
    Recipient checks cannot reserve the agent
    across the prompt submission: a change detected afterwards is reported as
    possibly delivered to another agent. Check the pane before sending again.
    A note offers **Start an agent** in a chosen workspace: World starts the
    agent in a new tab and sends the note once it is ready.
  - Drawing (desktop): the tools on Board's left edge draw beside the live
    cards, on the same pan and zoom, beneath cards and strings. **Pen** draws
    freehand (it stays chosen; Escape puts it down); **Rectangle**,
    **Ellipse** and **Diamond** drag out a shape or, with a click, draw one at
    a standard size; **Text** places text where you click; **Arrow** drags
    from one place to another, and an end dropped on a card, a note or a
    drawing attaches to it and follows it as it moves; **Note** places a
    note. With **Select**, click a drawing to select it, drag it to move it
    (a moved arrow lets go of what it was attached to), drag a corner to
    resize it or an arrow's end to re-attach it, and double-click a shape or text
    to type its label. The colour dots and **Fill** change the selected
    drawing, or the next one. Delete or Backspace (or the bin button) deletes
    the selection; an arrow attached to it stays where it pointed. Undo
    (Ctrl/⌘+Z) and redo (Ctrl/⌘+Shift+Z or Ctrl+Y) cover drawings made on this
    device since Board opened; a drawing changed elsewhere since is left
    alone, with a notice. A move, resize or text edit of a drawing someone
    changed elsewhere meanwhile is refused with the same notice and their
    version stays; typed text reopens on their version. If you have already
    started another text edit, it stays open and the refused drafts reopen in
    turn when you finish it, so nothing typed is lost. Drawings are saved with
    the board on the World service (at most 1,000; a stroke keeps at most 2,000 points, simplified
    as it is drawn) and are visual only: an arrow never sends anything to an
    agent. Issues and pull requests are reached through their agent's tab
    card. A phone shows drawings but has no drawing tools; drawings there
    take no touches, and double-tapping empty board still makes a note.
  - Town's room and agent actions are in a selected card's bar too: a
    workspace offers **Rename…** and **Close…** with Town's dialogs and
    confirmation; workspaces and tabs offer **Herdr order ‹ Earlier / Later
    ›**, which moves the room or tab in Herdr's own order (Town's buildings
    and desks and Spaces follow; Town's saved room spots swap with it), while
    dragging and Tidy arrange only the Board. Resting the mouse on an agent's
    tab or pane row opens a peek like Town's (latest Chat message, its
    question and answer buttons, **Mark reviewed**, **Open**); on a phone,
    **Preview** in the tab's bar opens it, and a finished agent's bar offers
    **Mark reviewed** (done, or idle after a turn World saw end, as Town
    counts it). The `?scene=town-scale` preview's synthetic hosts take all of
    these actions in the page, so they can be tried without real hosts.
  - Drag a tab onto another workspace of its host to move it (asks first,
    with **Don't ask again**; moving a workspace's last tab always asks,
    because that workspace closes). Strings follow the move.
    On phones, hold a card still before dragging; adding a second finger switches
    to pinch zoom without committing a move. Settling pauses while you type in
    an open terminal.
  - After a Herdr restart, strings that cannot be confirmed ask Keep or Detach;
    strings whose target closed wait in Needs a home. Selecting a card opens
    the shared Inspector. Development builds add an event trace for bug reports
    ([development tools](docs/development.md#development-tools)).
  - **Work**, the first labelled pill in Board's bottom-right controls, lays your pull
    requests out as columns: In review, Fixing (changes requested, checks
    failing or conflicts), Green (checks pass, a required review is pending),
    Ready to merge (approved, or passing where no review is required) and
    Merged; the Tickets tab
    groups Jira tickets and assigned GitHub issues by status. Each card links
    to the pull request or ticket and names the agents working on it; tap an
    agent to jump to its card. Escape, Back or a press outside closes it. See
    [Sources](#sources-github-and-jira).
    On phones, close a full-screen Inspector with X/Back to return to these
    controls. Work keeps its label and 44-pixel tap height. **Needs a home · n**
    remains a separate action for detached note strings; at zero or when space
    is tight, find it in **⋮ → Needs a home (n)**. Phone **Tidy** lives in **⋮**;
    Fit and zoom buttons also move there as needed to keep one row.
  See the [Board exercise](./docs/TUTORIAL.md#board).

- **Desk** organizes the filtered hosts' agents by what
  they need from you rather than where they run:
  - **Needs you** lists blocked agents, oldest first, with the question and choices
    read from the agent's screen; **Answer** opens the Needs you tab at that agent.
  - **To review** lists finished turns with your request, the agent's closing
    report, how long it ran, its tool calls and the files it edited, all read from
    the session transcript. **Mark reviewed** (`E`) acknowledges a turn across
    browsers of the same World service.
  - **In flight** lists working agents with their current request and a live line
    from each terminal. Quiet agents collapse below.
  - **Agents** lists every agent in the host filter, those you recently opened from the
    Desk first, then each workspace by recent activity. **Reviewed** lists the
    latest stop you marked for each idle or done agent, newest first, with
    **Reopen**; marking offers **Undo** for that exact stop across browsers.
    Marks, observed stops and recent opens are saved in bounded World storage,
    bound to their original connection, terminal and known agent session. They
    survive reloads and service restarts, reappearing after fresh verification.
    A terminal confirmed absent or a positive session replacement clears them;
    previous browser-local Desk marks are not imported. Marks agree even when
    browsers read different receipts; later stops or native activity need review.
    Review marks survive expiry of the stop's display time. Native state-change
    progress reveals later completed work even when no browser saw it working.
    Newly detected stops refresh their receipts. An older report cannot enable
    **Mark reviewed** during refresh; unavailable reports can settle without
    blocking review.
  - On wide screens, opening a card snaps that agent's Inspector to the right (on
    Chat, or the terminal when the agent has no Chat or **Agents open** is set to
    Terminal) beside the Desk as a reading pane and folds the lanes
    into one queue. `J`/`K` preview the next agent there, `Enter` opens it using
    **Agents open** and `Esc` closes the pane. Phones open the Inspector full screen.
  - One search (`/`, `Ctrl+F` or `Cmd+F`) filters every mode by agent name, thread title, harness,
    workspace, tab, folder, request and report. Agents are named by the thread
    title their harness writes to the terminal when they have no Herdr name.
  - `J`/`K` move between cards; `Enter` opens the agent's Inspector using **Agents open** to
    answer, review, or watch. Expand an outside-filter host's summary chip to see
    its agents. **Reveal & open [agent] on [host]** explicitly adds that host to
    Hosts and opens that exact agent's Inspector while preserving existing open
    resources. Host controls remain visible beside a reading pane and wrap below
    the counts on phones. Cached, unavailable or replaced agents explain why they
    cannot open. Leaving Desk or starting another opening cancels a pending
    reveal permanently; supersession keeps current agents available to retry.
- **Spaces** is the focused operational workspace: terminals, files, changes,
  annotations, worktrees, and Agent History for one selected connection.
- **Town**, **Board** and **Desk** show the aggregate of local and SSH hosts.
  **Hosts** (in the top bar; on a phone in Zen, in the corner view menu too)
  defaults to All hosts and persists an explicit host set independently
  of **Manage connections**; both places show and change one filter per
  browser. It lists every connection of either runtime,
  Herdr's first; a herdr-core connection reads `<name> · herdr-core · <state>`
  and is counted, selected and remembered like a Herdr host (profiles of one
  runtime endpoint count once). Filtering preserves open resources and terminals;
  removed saved identities are pruned, with an explained return to All hosts
  when none remain. Offline hosts keep labelled roots; an empty catalogue offers onboarding.
- **Needs you** in the top bar (in the view picker in Zen, including on a phone;
  outside Zen a phone shows it as an inbox icon with a count badge, hidden at
  zero, right after the view's name) counts
  open questions and the blocked agents of the hosts the Hosts filter shows, in
  every view, and opens the **Needs you** tab on the left: beside the view on
  wide landscape screens, over it on narrower ones, full screen with **Back** on a
  phone, where it takes focus, keeps the app behind it out of reach and gives
  focus back when it closes. It stays open or closed per device; while closed and anything waits, a
  **Needs you** handle sits at the left edge. Each item is a compact notification
  from its agent with Chat's formatting: one header row (its mark, name, place
  and age, then icons), the message, and answer controls only when the agent
  asked. **?** questions show their options as quick replies (the first
  highlighted; **Other…** opens a typed answer) or one answer field with a send
  icon, plus why an alert for you may not have arrived. The answer field's
  paperclip attaches files or screenshots (also by paste or drop; on a phone it
  picks photos or files). Each file uploads as a chip with a thumbnail that
  **✕** removes before sending; the answer then ends with `Attached files:` and
  one stored path per line, which the asker receives and `herdr-world ask get`
  shows. Files are stored on the asker's host with the terminal upload limits
  and retention, even after its connection restarts; while that host is down
  the file is refused rather than stored elsewhere. Only an asker World never
  tied to a connection stores files on the World host.
  **!** blocked agents show
  the agent's own question with its options as quick replies, answered and
  confirmed as Chat does (the same card, including Claude's recorded questions
  and its folder-trust choices), with **Open Terminal** when the answer could
  not be confirmed; **✓** finished work lists done agents and idle agents the service saw
  finish in the last 12 hours, with no answer row (Desk's To review lane can
  also list idle agents from recent transcript turns). Every item names its
  agent and marks an unverified asker; the name and the chat icon (**Open in
  Chat**, or **Follow up in Chat** for finished work) open the agent's Chat.
  The **✕** icon keeps each kind's own action: **Dismiss question** on a
  question, **Mark reviewed** on finished work (it marks the report shown, says
  so if the mark could not be saved, and the item offers **Retry** if the report
  could not be read); a blocked agent has none. Every icon has a label and a
  tooltip. When a verified terminal has several questions, **Dismiss all N
  questions from [asker]** closes its whole open backlog in one step, across
  pages and runtime restarts, without answering or closing another terminal's
  questions. Failed saves stay visible for retry; unverified claims are not
  grouped. Testing only: open `?questionBacklogFixture` (removed immediately)
  for 20 synthetic Atlas questions and one Beacon question; dismiss Atlas and
  Beacon stays. The fixture never contacts a runtime; reload to leave it.
  Worlds started with the same `HERDR_WORLD_INSTANCE_REGISTRY_DIR` and attached
  to the same runtime show each other's open questions (up to 60 per World,
  from up to 8 Worlds, refreshed every 5 seconds and on each question alert),
  marked **Asked in [World]** with a link. Answering or dismissing one there
  closes it in the World that holds it, which records exactly one answer and
  delivers it to the asker; a second answer, from any World, is refused as
  closed. A question stays with the runtime it was asked on, even if that saved
  connection is later edited to target another. A long question is shortened
  in the alert so its World's name always arrives. Places, IDs and attachments
  stay with that World. When it stops, its
  questions leave the others at the next read (a failed read keeps them 15
  seconds); answering then says it is not running. An alert whose question this
  World cannot read (no shared registry, an older World, or another runtime)
  shows as **Asked in [World]** with a link when known, no answer field, and
  **Hide alert**; up to 20 are kept until World restarts. Testing only: open
  `?siblingQuestionsFixture` (removed immediately) for one local question, one
  held by another World, and two alert-only entries; answering an alert-only
  entry is refused.
  A message longer than two lines shows **more** on its last line: it,
  or a tap on the text, shows the whole message in place with its links, and
  **less** clips it again. Keyboard focus entering the message reveals its
  links. Hovering the agent's name shows its card with
  the latest message. An answered question folds to one line until the tab
  closes. It shows a page of 30 items; **Show … more** and **Show the … before**
  turn the page, and every opener turns to its item's page. Town's post
  office sign opens it too. Town's reception
  letters, Desk's **Answer** and the **!**/**✓** badge on a Board card open it at
  that item. When Town has saved answers to check, **✉ Outbox** at the foot opens
  Town's Summary there. It replaces Town's Needs you rail.
- One set of agent marks, each with one glyph, colour and word, in Town, Board,
  Desk, Chat and the phone bar: • Working, ! Needs you, ? Asks you, ✓ Done,
  – Idle or Reviewed, ~ No signal, × Offline (`web/src/world/agentMarks.ts`).
- Inspectors and terminals capture their own host, runtime generation and resource
  identity. Focus and filters cannot retarget them. Global creation confirms one
  destination; room creation inherits its room. Notifications outside the filter
  open a labelled Inspector with an explicit Reveal in Hosts action.
- Open Inspectors, terminal buffers, split geometry and same-runtime Message
  drafts survive browser transport disconnects, including mobile backgrounding.
  When a connection reconnects to the same destination, an unsent draft moves
  to the same terminal in the new runtime. Drafts stay in memory only, so a
  reload starts empty.
  Last observations show a disconnected indicator and stay non-actionable until
  fresh admission. Terminal recovery offers **Retry terminal** and an explicit
  **Reload app**; a no-frame watchdog never reloads the page automatically.
- Search covers observed entities beyond renderer limits and pages matching results.
  Every view's search matches each word of the query in any order and any
  case, as Pane Search does: `builder login` finds the builder agent whose
  task mentions login, in Town, Board and Desk alike. Each result shows its
  type (building, room, table, agent or terminal), its name and status mark,
  and its place (`host › room › table`), so twins on different hosts are told
  apart. Names come first, then places, then task-summary matches, which show
  a short excerpt with the matched words picked out. On Board the results
  float over the top of the board and its count matches the list; **Down**,
  **Up** and **Enter** pick and select a result, and **Escape** ends the
  search.
  Counts distinguish observations, rendering omissions and unavailable coverage.
- Use **Arrange windows** in the shared shell to show the active terminal alone,
  cascade open windows, fit them in columns or rows, tile them in a grid, or
  restore their previous positions. Spaces arranges the focused workspace's
  existing tabs; visual views arrange their open, non-minimized Inspectors. The desktop controls sit in the top bar; mobile puts it in the ellipsis-expanded controls. The same
  placements are in **Actions** and can be given custom keyboard shortcuts;
  none are assigned by default. Layout
  choices that cannot fit explain why.
- Inspectors and arranged Spaces windows share snap, minimize, maximize/restore,
  close and all eight resize handles. Each window has one bar: its name, a
  location line, the view selector and **⋯**, **− Minimize**, maximize and close. An agent is
  named `<name>-<harness>` (for example `otter-claude`), shortened in the middle
  past 14 characters, and its state is a badge on its icon: a tick when done, a
  spinner while working, **!** when it needs you and a grey dot when idle. **⋯** holds
  a minimize shortcut, the snap choices and float. **Fit right** and **Fit left**
  come first: they put the window against that edge, full height, at its normal
  docked width (520 px, at most half the screen, or the width you last dragged a
  docked window's inner edge to) and leave the rest of the view usable; the half
  and quarter snaps still fill their region. A fitted window keeps its inner-edge
  resize handle. The same two placements are in **Actions** for the active window
  and can be given keyboard shortcuts; none are assigned. Phones have no fit
  choices because windows fill the screen there. Tapping the location line under the name
  shows the branch, worktree and PR status, replacing the card above Changes. In
  Town the window takes the Town look (portrait, pixel name, chunky buttons,
  **‹ Back**), and so does its Chat: Town's colours, framed messages with
  yours in soft gold, raised keys, a soft gold **Send** and the agent's
  recommended answer in the same gold. On touch screens or without a pointing
  device, narrow Town columns keep 40px window controls; the pane map hides to
  leave room for the agent's name. On a phone the window fills the screen like the
  terminal: its bar shows the name and status, and **⋯** switches the view
  (Chat, Terminal, Changes, Files) or switches to another agent or terminal. Opening or focusing a window preserves other
  placements; snapping into an occupied region overlaps without rearranging it.
  Tiled windows share resizable dividers. **Open windows** restores minimized windows.
  **− Minimize** stays visible on phones. There, a minimized window waits as a
  chip at the bottom left of Town or Board, above the bottom controls and also
  in Zen: one tap on the chip restores it. While another window fills the phone
  screen, the chips sit in a strip at the bottom of that window, below its
  content, so a minimized window is still one tap away; its **⋯** and **Tabs**
  in the expanded mobile controls also list windows.
  **Close** (or **‹ Back**) dismisses
  the window; open the agent or terminal again to reopen it. Minimizing or
  closing a window leaves agents and terminal sessions running. Native tab
  closure remains separate.
- Menus, dropdowns, pickers and the workspace list opened from a terminal's
  title close top first: Escape and Back close only the topmost one; a press
  or tap outside all of them (on the terminal, say) closes them all, so one
  tap shows the terminal, and a press inside a lower one closes only those
  above it. Escape, Back or a choice returns
  focus to where it was, such as the terminal. The phone's Tabs sheet
  and Composer close with the phone's Back.
- Mobile shows one active window and preserves desktop positions. The on-screen
  **Back** first closes an open menu or the workspace list (opened from the
  terminal's title), then returns from a terminal to the visual view even with
  Composer open; the phone's own Back closes Composer first, then the terminal. Tabs and More stay in the shared top app bar; More exposes Arrange windows.
  Tabs also restores minimized windows and retains native tab actions. The duplicate
  list icon and mobile tab strip are hidden. The outer shell coordinates terminal sizing with the keyboard viewport.
- A Spaces tab window shows that tab's Herdr split panes. An Inspector in a visual
  view also shows the selected tab's split panes in one window; selecting a sibling
  pane keeps the same Inspector and updates its pane-specific resources. A
  multi-pane tab's window title starts with a drawing of its split (the shown
  pane in the accent colour, a pane that needs you in yellow); one tap opens a
  map of Herdr's real layout and tapping a pane switches Chat, Terminal and the
  rest of the window to it without moving Herdr's own focus. When the
  Spaces Inspector is on Terminal, **Focus tab window** goes to the active tab
  without attaching a second terminal.
- A failed host may retain its last observed topology as visibly stale,
  never actionable. Selecting a live entity revalidates its connection generation
  before opening the same terminal or host-specific Inspector context.
- A slow host does not hold back another host’s controls: World returns a
  complete host list within 20 seconds, marks unfinished host views stale, and
  refreshes them when their observations complete.
- The **Actions** command menu stays at the right of the top bar in every view
  (`Cmd+K` on macOS, `Ctrl+K` elsewhere). Use it for workspace/tab creation,
  window arrangements and the selected target's available resource actions.
  Check the selected host and target before acting. A host, generation or
  observation change invalidates an open target; Actions does not send input
  or assign tasks to an agent.
- In Town, Board and Desk the command menu is also World's command box. Type
  and it finds buildings, rooms, tables, agents and terminals as the views'
  search does, each with its status mark and place (`host › room › table`);
  **Enter** or a click selects it as clicking it in the view does. It also
  goes to another view. In Zen it opens from the **⌘** button beside the
  view buttons; on a phone, from **Find or act** in the corner view menu. In
  a terminal, the Chat composer or a text field `Ctrl+K` and `Cmd+K` stay
  shell and editor keys; `Ctrl+Alt+K` (`Cmd+Option+K` on a Mac) opens the box
  from there.
- World runs as one application and one browser origin. No remote World/Roamgate
  service or browser bridge URL is required for an SSH host.

### Integrations

**Menu → Settings → Integrations** lists everything World reads from or works through.
**All** opens first and lists every kind under its heading; then one tab per
kind: **Runtimes** (this computer's Herdr or herdr-core and each SSH host),
**Sources** (GitHub, Jira, Weather and Usage metrics), **Agents** (World's skill for
each harness, per host) and **Editors** once one is listed; last, set apart
with its key, the **Vault**. The kind tabs come from the registry's kinds, so a new kind gets
its own tab; a kind with nothing in it has no tab, except Runtimes and
Agents. Each tab shows how many rows it has and a warning mark when one is
failing; the tabs stay on one row and scroll sideways on a phone. The screen
reopens on the tab you last used, or on the row an element's **Connect**
asked for.

**Search** always searches every integration and the vault, by name, status
(`error`, `needs connect`), transport (`ssh`), what a row gives (`tickets`)
or a token's name: typing opens **All** with every match under its kind, and
the counts become match counts. Picking a tab then narrows the results to
that kind; a tab with no match names the tabs that have some
(**Runtimes (1)**) and offers **Clear search**. Agents match within the
host's agent list. To try the screen with dozens of rows, open World with
`?integrationsFixture`: the page drops the parameter and the screen adds 40
sample rows (hosts, trackers and an **Editors** tab) in every state until the
page reloads. Sample rows have no action and give World nothing.

Each row leads with the product's mark where World has one (Herdr, GitHub,
each agent) or a plain symbol (tickets, usage), says what it
gives World (terminals, agents, files, pull requests, tickets, weather or usage) and
shows its state as a coloured chip; its actions stay on its right, on a phone
too. A source's settings open under its row from the settings button
(**Jira settings**). Each kind's own action sits on its heading in **All** and
at the top of its tab: **Add or edit hosts…** for Runtimes, **Refresh
Sources** for Sources.

- **Connected**: in use now.
- **Available**: ready to use; **Connect** switches it on at once.
- **Needs connect**: needs settings first; **Connect** opens them (Jira's site,
  email and token, or the Prometheus URL).
- **Error**: World tried and failed; the row says why.

A source row follows its source while the screen is open: a check that
finishes or fails after the screen opened changes the row at once.

**Connect** and **Disconnect** apply at once. A runtime row acts on the exact
connection it showed: if that connection was replaced since the list was
read, it refuses and asks you to check again rather than acting on the new
one. **Add or edit hosts…** opens the same profile editor as **Hosts → Manage
connections**. Nothing here is required; every request goes from the World
service, never from the browser. A World element missing what it needs (the
closed warehouse, Work's empty lens, Town with no hosts) offers **Connect**,
which opens this screen at that row.

The **Vault** tab shows where World keeps the tokens integrations need
(today only the Jira API token): an owner-only file in World's data
directory. It lists each token by name with the integration that uses it,
never its value. A token is entered in its integration's settings and is
write-only from the browser; links, symlinks or unreadable files are refused. There is no OS keychain backend yet. The registry is read-only
at `GET /api/world/integrations`; editors join it as they land.

### Sources: GitHub and Jira

World reads your pull requests and tickets itself; there is nothing else to
install. These two work sources are on by default. Open **Settings → Integrations**
to see each source's state, switch it off or configure it under **Settings**.
The separate [Weather source](#weather-source) is off by default.

- **GitHub** uses the GitHub CLI signed in as the user that runs World (`gh
  auth login`): open pull requests you opened, were asked to review or are
  assigned, pull requests you opened that were merged in the last 7 days
  (change the window in **Settings → Integrations**, 1 to 90 days) and issues
  assigned to you, each with review state, checks and mergeability. World
  stores no GitHub credentials. Work's **Merged** and **Done** columns group
  cards by the day each was merged or resolved, newest day open; tap an older
  day to open it. GitHub history is bounded to 400 pull requests and one
  minute per refresh, after your open PR action details. If history is
  shortened, World keeps its last complete list, reports the oldest merge
  date actually observed (or no confirmed date), and asks you to shorten the
  window in **Settings → Integrations**; partial history does not authorize actions.
- **Jira Cloud** needs a site, your account email and an API token. The token
  stays in World's private storage on the service and is never shown again;
  changing the site or email removes it, so enter the token again with them.
  The filter (JQL) defaults to tickets assigned to you or that you watch.
- An agent is linked to the pull request whose branch its checkout is on (the
  branch's own repository, or fork, is a GitHub remote of that checkout), to a
  pull request it reported with
  `herdr-world agent-checkout --pr`, and to a ticket whose key its branch names
  (for example `abc-12-fix-login` and `ABC-12`). Its Town desk shows the badge
  on its nameplate (`#123 ✓`, `#123 ✗`, `#123 ●` or `ABC-12`), its Board tab
  card shows the same badge, and Board's Work lens names it on the card. Town's warehouse shows every open pull
  request for you as a crate, including those whose agent has gone. A link holds only for the agent session and
  Herdr runtime it was made in.
- **Your open pull requests** get a card in Work with CI on the head (a dot
  per check), each explicitly attributed rev agent's latest `RESULT #N: …`
  from a formal review or comment, and your merge rules: not a draft, every finding confirmed, CI
  green on the head, mergeable, and screenshots for a change to the web app
  or site. Each rule shows ✓, ✗ or ? (World can't tell; a confirmation of an
  older head is ?). **Details** lists the failing checks with links, the
  reviewers, the head commit and how far it is behind its base. RESULT posts
  without a clear reviewer claim stay visible as **Unknown reviewer**, with
  **View RESULT source** links, and cannot confirm readiness. Names are sender
  claims, not verified identities; a shared GitHub login does not identify a
  crew reviewer. Reviewed heads come only from review commit metadata or an
  explicit, unambiguous SHA, never a timestamp. A card says
  **Ready to merge** when every rule holds, and **Stalled** when CI failed on
  the head and its agent is idle.
- Cards show GitHub detail health and its own read time. Expired or failed
  reads retain matching **stale · cached evidence**; list success does not
  refresh it. Findings/screenshots stay unknown and World requires fresh
  detail before merging. Use **Refresh Sources** to retry. See
  [detail health and bounds](docs/github-pr-detail-health.md).
- **Merge…**, **Close…** and **Mark ready…** (for a draft) open a sheet that
  says exactly what happens; nothing runs until you confirm. Merge makes a
  merge commit, keeps the branch and refuses if anyone pushed since you
  looked; failing rules make it **Merge despite N failing rules**. GitHub's
  answer, or its reason for refusing, shows on the card. World never bypasses
  branch protection: while GitHub requires a review, the card offers **Open
  on GitHub** and **Copy merge command** instead of Merge. The same card
  opens from the pull request's badge on its agent's Town desk (a sheet on a
  phone).
- A source that is not signed in or configured says how to connect it (Work
  shows a quiet **Connect** button for one you never set up, which opens
  Integrations at that source); the views work
  without it. The service refreshes at most once a minute while a visible
  browser tab shows sources, answers at once with what it has while a refresh
  runs, and the browser never contacts GitHub or Jira.

### Retired views and runtime boundaries

Office, Tree and Graph are retired. Bookmarks still work: `/office` opens Town,
and `/graph` and `/tree` open Board. The Inspector opening preference and Town's
calm motion keep their saved values; Office's room alignment and long-title
settings are gone. The optional Prometheus cost metrics now appear on the Town
board; Board's notes and strings do not depend on Prometheus.

World admits simultaneous qualified local and SSH contexts. Runtime replacement
retires only its own windows and pending work; whole-World disconnect or
authentication loss retires all old leases. Unacknowledged input and mutations
are never automatically replayed; refresh the exact target before retrying.
The responsive installable PWA is the mobile client.

### Session task summaries

Agent harnesses can use `herdr-world task-summary` to publish a short, expiring,
session-qualified description of current work for an exact local or fixed-policy SSH
Herdr pane. The Inspector shows it only while the current
agent session matches the report. Herdr owns expiry; the command does not infer work,
assign tasks, or provide a Clear operation.

### Apartments: finished agents

**Apartments** holds every agent that is not running now, asleep and
resumable: agents from before Apartments existed, on every connected host
(Herdr TUI and herdr-core). Agents move in three ways:

- **Found asleep**: on each connected host World reads the transcripts Claude
  Code (`~/.claude/projects`), Codex (`~/.codex/sessions` and
  `archived_sessions`), Pi and Oh My Pi keep, honouring `CLAUDE_CONFIG_DIR`,
  `CODEX_HOME`, `PI_CODING_AGENT_DIR` and `PI_CONFIG_DIR`. Each such agent
  moves in with its harness as name, its folder, its session, when its
  transcript started and was last written, and its first request as summary.
  World looks through a host's histories when it first sees the host, then
  every 15 minutes, newest first and at most 400 transcripts read per pass
  (a longer history continues a minute later). It reads only each file's
  first bytes, once per World run, and writes nothing on the host. Codex
  subagents and Claude sidechains are another agent's helpers, not agents.
- **Its terminal ended**, seen by World while it observed the host.
- **Retired by the bus** when the bus took it from the bin.

Each resident keeps its name, harness, project folder, room and tab, host, when
it ran, its last task summary, its last report (the closing message of its
transcript, when the host answers within ten seconds; added just after the
move-in, and lost if World stops first), the pull requests and issues the
Sources linked to it, and its harness session (the one its Chat reads: Herdr's
report, or for herdr-core a linked Codex session, Claude's process record or
the launch command, read again while the agent runs). One session is one
resident: an ending World sees replaces the found record of that session.

- Open it from the green **APARTMENTS** sign on the sandstone block in Town's
  park beside the town center (left of the plaza, or right when there is no
  room; a town too small for it hides the building), where the bus brings
  binned agents to its door and the sign's count goes up as each walks in
  (see **Bin and bus** under [Visual control plane](#visual-control-plane)),
  from **Apartments** in
  the town center ring, or from **Apartments** in Board's hub. All three read
  the same residents, and the ring and hub show how many live there.
- Each resident shows its avatar, as Town and Inspector show a live agent:
  its Town character on its terminal colour, with its harness's icon, in the
  list (with its harness, project, room and host) and larger in the opened
  resident. World keeps the avatar at move-in: the avatar chosen for its
  pane, else its profile's look, else the character Town drew for it, and
  the colour Town showed: its tab's, else (a spawned agent) its parent's
  tab's, else its room's. Herdr TUI and herdr-core residents look the
  same. A resident whose avatar was not kept (it moved in before World kept
  avatars, or World found it in its harness's history) shows the nearest: its profile's look, else a profile of the same
  harness, else World's default character; hovering the avatar says which.
  Its colour then falls back to the plain tile.
- `?apartments-preview=avatars` in the page's address shows synthetic
  residents, one per avatar case, for that load only (the page removes it at
  once; nothing is saved).
- A resident whose session runs again at a desk is hidden while it runs, and
  returns when it stops, also when its terminal stays open with a shell. Its
  newer end is recorded when that terminal closes. A transcript written in the last 10 minutes is left
  for a later pass, since its agent may still be running.
- Search matches name, harness, project, folder, room, host, summary, report,
  `#42` or `PR 42`, repository and the day it ran or moved in (`2026-11-19`).
  Residents list newest first; the newest 200 matches are shown, and a search
  finds older ones.
- Opening a resident shows its facts, how it moved in, summary, report and
  linked work. **Read history** reads its conversation from the harness
  transcript on its host, the same chat reading Inspector uses (the latest 200
  messages); a message opens in full. History needs that host connected.
- **Resume in room** starts the agent again with its harness's own resume
  (`claude --resume <session>` or `codex resume <session>`) in a room on the
  host where it ran: its old room when it still exists, or the one chosen. A
  Herdr TUI room opens the new terminal; herdr-core says it is back. The
  command is also shown to run by hand. Resume is refused on another host,
  for a resident with no session, and for harnesses other than Claude and
  Codex; the resident stays either way.
- **Evict…**, then **Evict**, forgets a resident. Its transcript stays on the
  host, and a later pass does not bring it back; it returns only if it runs
  again and World sees it end. World keeps at most 5000 residents, whatever
  their age; the longest asleep go first. Running, recent, empty and evicted
  transcripts take none of those places.
- Limits: Kimi, Grok, Muse and Antigravity keep histories World does not look
  through, so their agents are recorded only when World sees them end. An
  agent whose host disconnects, restarts or changes runtime generation is not
  recorded as ended, nor one that ends while World is stopped; a found record
  covers it later when its harness is one of the four above. Found agents have
  no room, tab or linked work. Records live in World's own store on this
  computer.

### Teams and spawn stamps

World groups terminals that know each other. Each relation lists its evidence,
one entry per source, with the source's system of record and whether it holds
now: a **spawn** (Herdr pane metadata while it lives, then World's saved copy)
or a **manual Team** (saved by World). Evidence for a terminal that is gone or
on a stale host is shown as stale, not dropped. Herdr records no creator for a
tab or pane, so a spawner stamps the child:
`herdr-world stamp CHILD_PANE PARENT_PANE` (`bun run agent:stamp --` in a
checkout). Board's **Start an agent** stamps the new agent when its note is
strung to one pane. Town draws teams as walls and connectors; Board strings
related cards and groups a tab dropped on another tab, or chosen with
**Group…** and a tap; **Ungroup** undoes it. Existing saved magnetic groups
migrate automatically to kind Team; these controls continue to act on Teams.

### Groups

**Actions → Groups** opens the existing movable panel window (full screen on
phones). Filter All/Pod/Team/Room/Desk, then open a row for member roles, live
status, linked open PR cards, the ordered Now list and recent sender attribution.
The roster shows shared reviewers with rings and warns above the Pod's open-PR
limit without blocking edits. Unavailable work is unknown; failed refreshes are
labelled cached. Away and ambiguous addresses never contribute live work/status.

Town's open **Summary** shows a **Pods** section after Hosts and rooms, with
the same status, first Now item and source-qualified PR warning. Tap a Pod to
open or raise its Groups detail. Pod roll-ups do not add to reception counts.

Create Teams/Pods, add/remove members, edit roles, name/Now/limit, delete with
confirmation or explicitly promote a Team with a complete current address mapping.
Exclusive-role transfers ask first. An edit or confirmation based on an older
Board revision is refused and refreshes the roster. Add, Edit and Roles keep
their drafts open until a write succeeds; after a conflict, review the current
values and choose **Use current version** before explicitly saving again.
Current-agent selection refuses a replaced agent or a duplicate Herdr name;
rename duplicates or supply an explicit qualified address. Ambiguous member actions
inspect a qualified match without treating it as resolved. Room/Desk membership
belongs to Herdr and uses Town's move gestures or guarded CLI moves.

### Agent CLI (`herdr-world --skill`)

Every standalone installer run and `herdr-world update` discovers supported
harnesses by their existing config folders and installs or refreshes the release's
World guide (plus Claude's limits tap). This also runs when World is already
current; `update --check` is read-only. Per-harness output says whether World's
integration was installed (new), updated (changed), already current (unchanged),
skipped or failed, and gives `herdr-world integration uninstall <harness>`.
`HERDR_WORLD_SKIP_INTEGRATIONS=1` keeps these manual, independently of
`HERDR_WORLD_SKIP_HERDR=1`. A conflict or failure is reported and other harnesses
continue; an installed World update and its service restart still complete.
Use `herdr-world integration sync` to retry discovery, or install manually with
`herdr-world integration install claude` (or `codex`, `pi`, or another
[Herdr harness](./docs/harness-integrations.md)).
Start a new harness session to discover the `herdr-world` skill.
Installation is local to the host and needs no running World service.
It never overwrites an unmarked or wrong-ID user skill, nor creates a missing
harness config folder. Unreadable or unsafe files fail without replacement.
`integration status [harness]` lists the state, version and path;
`integration uninstall <harness>` removes it and records a persistent preference,
even if already absent. Later installs and updates keep it removed until explicit
CLI or Settings install reenables it. Codex, Pi and Kimi share
`~/.agents/skills/herdr-world/SKILL.md`; removing one also removes it for
the other two, which the command names; their removal preference is also shared.
OMP, Letta and MastraCode report
unsupported. See [paths and overrides](./docs/harness-integrations.md).
**Settings → Integrations** shows the same state and path as a
**World skill** line under each Herdr harness on World's own host, with
Install, Update and Uninstall buttons that run the CLI's installer; uninstalling
a shared file confirms which harnesses lose it first.

The Claude install also chains the existing status line through World's limits
tap. Sessions started outside World update the host's Claude Fuel gauge; the
previous command keeps its input and output. Reinstall never chains World twice.
Uninstall restores the original settings bytes when unchanged and preserves later
user edits. See [settings safety and preview](./docs/harness-integrations.md#claude-limits-tap).

Agents change World objects themselves from their pane, through the running
World service. `herdr-world --skill` prints the guide; commands answer in JSON
when piped, with stable exit codes:

- `colour set|reset`, `board card pin|unpin|move|group|ungroup|colour`: Board
  cards and tab or workspace colours. Recorded with the agent and time;
  `history` lists changes and `undo <change>` takes one back.
- `town desk move … --herdr`: reorder a desk in its room with Herdr's tab
  order, as a drag in Town does. It needs `--herdr` because it changes Herdr,
  and World cannot undo it.
- `ask "…" [--key CAUSE] [--options a,b] [--owner-only] [--wait]`: a question
  for you. It appears first in the **Needs you** tab and Town's Summary, where you
  pick an option or type an answer; `--wait` returns that answer to the asker.
  Its agent waits at reception with **?**; Board and Desk show the same mark.
  Each question names its agent as Town labels its desk, with **Open agent**
  (a shell pane without an agent opens its terminal),
  and **Dismiss** closes it without sending an answer (`--wait` then returns
  `dismissed`). A caller World cannot verify is marked unverified; it still
  reaches reception when exactly one local Herdr has the pane it names. A new
  ask follows your chime, toast and OS notification preferences, naming its
  agent with the question's first line and **Open agent** for its exact
  original seat. Reception shows failed or uncertain alert delivery while
  keeping the saved question answerable. World commits a new ask and its attention intent together in
  `world.sqlite`, then alerts you through its captured Herdr connection.
  Herdr's toasts, connected Worlds and phone notifications can receive it even
  when no World tab is open. The CLI retains a fallback alert through the asking
  pane's Herdr if World could not record it; it names the failure and exits 1.
  When no alert is confirmed yet, exit 6 (`not_delivered`) carries the recorded ID;
  `retrying: true` means the service will retry a temporary failure with backoff.
  At 20 open questions per verified terminal (or the shared unverified
  allowance), or 500 overall, new asks return `question_cap` (exit 3, HTTP 429)
  and tell the caller to wait until a question closes. These refusals never
  alert or chime, including repeated attempts; the CLI sends no fallback alert.
  The allowance follows the terminal across runtime restarts.
  Closing the ask cancels a pending alert. Duplicates are possible after a lost
  reply or restart. JSON preserves `recorded` and Herdr's `notified` evidence
  (`null` for a repeated cause), including through `--wait`. Another verified agent (never
  the asker) may answer a question that is not marked `--owner-only`.
- `ask withdraw ID` or `ask withdraw --key CAUSE`: the original verified asker
  withdraws a cleared cause, including when a creation reply lost its ask ID.
  The same freshly verified connection and stable terminal can withdraw after
  a runtime restart or session change, even when generation and occupant
  fingerprint differ. Another terminal or connection cannot. Older records
  without stable terminal identity retain their original stricter checks;
  answer delivery and receipt authority still follow the original session.
  Answering or withdrawing removes its question marks. `--key` keeps repeated
  causes to one ask; after withdrawal a recurrence can create a fresh question.
  A waiting CLI returns `withdrawn` when its question was cancelled. Repeating
  an answered key returns its answer; human withdrawal output also names any
  preserved answer. Crew recovery handles lost replies, re-arms recurrences and
  reports permanent withdrawal refusals once for you to answer.
- `result --task ID "…" [--pr N] [--status done|blocked|failed]` and
  `result ls`: task results kept by World, instead of terminal scraping.
- `task-summary "…" [--ttl-ms MS]`: a short label for the current Herdr agent
  session, expiring after 15 minutes by default. `stamp CHILD_PANE PARENT_PANE`
  records parentage directly in Herdr; both accept `--session NAME`.
- `spawned-by <parent-pane>`: the spawn stamp, made by the child itself. It
  is display-only Herdr pane metadata, so it needs no `--herdr`; the parent
  it names is the child's claim.
- `whoami`, `ls`, `history [--actor]`.
- `group create|add|remove|lead|reviewers|now|list|show|delete|promote`:
  World-owned Teams and Pods, with `pod` and `team` aliases. Lead/reviewer
  edits follow crew rule reserving roles to you or FirstMate; sender claims are attribution,
  not authenticated permission. Exclusive-role transfers need `--replace --yes`,
  deletion needs `--yes`, and Team promotion needs a complete explicit address mapping.
  `group show` includes recent sender attribution (128 changes retained globally).
  Room/Desk groups are projected from Herdr. Adding with `--herdr` reuses Town's
  move: Room moves the whole desk and prints every affected agent first; Desk
  moves one pane; `--allow-close-room` also consents to closing the source room
  when its last desk leaves. Results report confirmed Done/Partly done/Not done/Unknown
  outcomes and locations, with no automatic retry on Unknown.
  `group import FILE --yes` migrates one Pod table atomically and never overwrites
  existing Pods; explicit address mappings handle away or annotated names.
  `group list --kind pod --markdown` renders the roster; files are never synchronized.

World checks who is calling: the CLI sends its `HERDR_PANE_ID`, and the
service accepts it only when the calling process runs in that pane of a local
Herdr (the pane's shell or foreground process is among its ancestors).
The CLI reaches only a World service on the same machine, with a token
derived from the service's signing secret that cannot log a browser in.
Otherwise the change is labelled unverified, or "terminal with no pane" when
no pane is named, since any process can leave it out; `me` and `spawned-by`
need a verified pane. The CLI never
merges, deletes panes, tabs or workspaces, or reaches outside World.

### Agent worktree in Files and Changes

An agent's **Files** and **Changes** share one worktree, independently of its
launch directory. The service considers the live Herdr pane `foreground_cwd`,
then the same agent session's native transcript/Codex rollout cwd or explicit
checkout report, then its branch matched in a scoped `git worktree list`.
The location line names the selected tree and branch; its source mark explains
**Live pane**, **Session cwd**, **Agent report** or **Branch match**.

Open that location popover for **Worktree** candidates and **Refresh**; phones
use the same choices in a bottom sheet. Pick a
radio choice to apply it to Files and Changes together. Repository-listed
alternatives are viewing choices, never branch ownership claims. Equal-rank
matches need a choice; stale or replaced-session evidence stops resource access
until refreshed. When the agent's binding changes while it works, Files, Changes
and Commits keep their last view, marked **Worktree changed · Showing last
observation**, and stay non-actionable until the worktree is read again
(opening one of them reads it). Chat and Terminal are never held by the
worktree: Chat's message box and controls keep working. For testing only,
`?worktreeChanged` makes the first agent window opened see its worktree
evidence as stale; opening Files reads it again. Files never silently
falls back to the workspace checkout.
Detached HEAD is supported. An outside-Git or inaccessible cwd is shown as
unconfirmed evidence, without scanning neighboring repositories.

An agent may still report its checkout with `herdr-world agent-checkout
/absolute/checkout --pane w1:p1`, optionally `--pr HTTPS_URL`. The report belongs
to that exact session, expires with replacement/restart, and its link is labelled
**Reported PR**. It is evidence rather than a claim of ownership; viewing another
candidate does not rewrite it. Existing file and Git actions use the selected
root and revalidate its qualified binding before acting.

If a previewed file becomes unavailable, its preview shows a notice instead of
closing the window: choose a current worktree or another file, then **Retry
preview**. Chat and its draft stay open.

## Workspace, Tab, and Pane Navigation

- Browse workspaces and recognized agents; create, rename, focus, pin, or close
  workspaces and create, rename, colour, switch, or close tabs.
- Group linked Git worktrees under their repository. Pin workspaces/worktrees
  to the top and collapse groups; preferences stay in this browser.
- With more than one server connected, the Spaces workspace list's heading
  switches between **Current** and **All servers**. All servers lists every
  ready connection's workspaces and agents from World's shared observation,
  labels each with its server and keeps worktrees nested. Selecting a row opens
  its server; another server's menu only navigates. Stale hosts stay out, and a
  failed observation shows its error. World's navigator keeps one tree per host.
- Workspace rows show numbered tab chips with each tab's agent status, folding
  extra tabs into **+N**, and keep the server badge in the right column. In
  Spaces a chip focuses its tab; in World's navigator it selects the workspace
  without moving Herdr's focus.
- Split panes right/down, resize boundaries, focus neighbors, zoom, or close.
  Drag a pane handle onto another tab in the same workspace, onto a pane edge
  in that tab, or onto **+** to break it into a new tab. Hover a tab to open its
  panes before dropping. Overflowing desktop tab strips offer scroll controls.
- Search workspace, worktree, file, tab, pane, and agent actions in the command
  menu (`Cmd+K` on macOS, `Ctrl+K` elsewhere, or `Cmd+Option+K`/`Ctrl+Alt+K`
  from a terminal or text field). A workspace-relative or
  absolute path opens the file.
- Toggle **Zen mode** (`Cmd+Shift+Z` on macOS, `Ctrl+Alt+Z` elsewhere) to hide
  the topbar, tab strip, and sidebar and run the terminal flush to the window.
  Hovering the Exit Zen tab slides the topbar back, and it stays while one of its
  menus is open. The sidebar still toggles inside Zen and returns to its prior
  state on exit; split layouts keep pane borders. Every World view opens in
  Zen by default, with one choice shared by Town, Board, Desk and Spaces; the
  settings menu's **Zen mode** switch turns it off or back on. While Zen is on,
  a view picker beside Exit Zen switches between the views. On a phone, Zen
  hides the top bar and bottom navigation on every root screen, Spaces' list
  included; a corner button opens the views, **Hosts**, **Find or act** and
  **Show the bars**. **Hosts** there opens the top bar's Hosts filter in the
  menu's place, with **Manage connections**, and changes the same selection;
  Tab moves between its controls, and Tab out of it closes it, as Tab closes
  the views menu. On a short screen the menu scrolls, so every choice stays reachable.
  A terminal is a detail screen and keeps its own bar, with Back. Stored in
  this browser.

Herdr 0.9.0 uses **Local navigation** per browser/connection; legacy connections
use **Shared navigation**. Reconnect preserves live selections; reload starts
from Herdr's selection. Closing/moving a selected pane selects a remaining pane
in its tab, then a remaining tab/workspace. Topology changes, terminal sizes,
and same-tab pane focus (including `follow` cwd) remain shared.

Creation preserves Herdr's cwd policy and needs an open, connected source
terminal tab; unavailable sources show an error. An empty session can create its
first workspace directly. See [compatibility](docs/DEPLOYMENT.md#herdr-compatibility).

### Recent Pane Switcher

The switcher includes the 12 most recently focused live panes plus the current
layout, across tabs/workspaces. Entries show workspace, tab or cwd, and agent
icon/status. Closed panes leave history automatically. The keys below use the
macOS preset; see [other platform bindings](#keyboard-shortcuts).

| Key | Action |
| --- | --- |
| `Ctrl+Tab` | Open at the previous pane; hold Ctrl and repeat Tab to advance |
| `Ctrl+Shift+Tab` | Move backward |
| `Up` / `Down` | Move through entries |
| Release `Ctrl` or press `Enter` | Switch |
| `Esc` | Cancel |

### Pane Search

`Alt+K` opens search over every live pane on the selected connection, including
panes absent from the recent switcher, and agents on the other ready servers;
choosing one of those opens its server's pane. Filter by workspace, tab, cwd,
agent name, or status. Search terms can appear in any order and must all match;
results retain their recent-first order. Use Up/Down or Tab/Shift+Tab to choose,
Enter to switch, and `Alt+K` or Esc to close. Releasing the opening modifier
does not commit a search selection. Press K in the recent switcher to convert it
to search.

## Full Browser Terminal

- Display Herdr's server-rendered terminal at browser rows/columns, with splits.
- Send normal input, modified Enter, macOS line-editing shortcuts, multiline
  paste, IME composition, and rapid CJK punctuation.
- On desktop, click terminal output to use physical arrow keys and Ctrl
  combinations, including after opening an agent's Message or switching views.
  The phone-only Composer does not disable desktop input or discard its draft.
  On phones, side-by-side keyboard (Composer) / terminal (Direct) icons stay
  accessible while editing an expanded draft; Direct hides and saves it, and
  Composer restores it. Special keys remain visible in both modes.
  The separate `/ Commands` control inserts command suggestions into the draft.
- Scroll history by wheel, trackpad, touch, or half-page
  `Alt/Option+Page Up`/`Page Down`. Full page keys go to terminal apps (such as
  nano) or Herdr history when the shell owns them; mobile buttons route the same
  way. Endpoint history needs advertised support; disabled controls explain why.
  Explicit half-page shortcuts remain history actions in mouse-aware apps.
- On Herdr 0.9.0, clicks/drags/wheels use pane-local cells in mouse-aware apps.
  Select browser text with Option-drag (macOS) or Shift-drag (elsewhere);
  ordinary output needs no modifier. Selection pauses visible endpoint output
  until cleared, then catches up. Drag past pane edges to scroll and copy
  offscreen rows. Release or blur stops scrolling; if output changes, finish
  the selection before scrolling further. Pixel mouse is unsupported.
- On macOS, **Settings → Keyboard → Option key as Alt**
  makes Option send Alt-modified keys instead of typing characters such as @,
  [ and ~. It is off by default and saved in this browser.
- Paste clipboard images to upload to the Herdr host and insert their paths,
  including through `--ssh-host`. When a composer sends an uploaded image's
  path, the path goes to the agent on its own and Enter waits for it, so Claude
  Code attaches the image instead of dropping the message.
- Native `Ctrl+V` (`⌘V` on macOS) pastes text or files even on plain-HTTP LAN
  addresses. On plain-HTTP addresses, a configured `Ctrl+Shift+V` on Windows
  and Linux also uses the browser's native plain-text paste where supported;
  use `Ctrl+V` or drag and drop for images.
  Over HTTPS or localhost it keeps async clipboard reads, including images.
  Other custom paste shortcuts need clipboard access over HTTPS or localhost;
  when unavailable, World explains how to use native paste, drag and drop, or
  a secure address.
- Every composer that attaches files (the phone Composer, Spaces, the Town peek
  and Inspector Chat) shows a chip per file: uploading with byte progress, then
  done or failed. A failed file can be retried, by **Retry** or by picking it
  again, or removed. Send waits until uploads finish, and picking a file again
  while it uploads does not upload it twice. A path that finishes after its
  composer closed joins the draft when that composer opens again.
- Drag a file or directory path from the File Explorer into a terminal to
  insert its quoted host path. Terminal font size is adjustable independently
  of interface scale in **Settings → Appearance**. **Chat text size** there sets Chat's
  text size: it follows the terminal font size until changed, and its value
  button links it back.
- Show Herdr session popup panes over the active workspace when a plugin opens
  a modal interaction. A plugin popup first focuses Herdr on the Space it was
  opened for, so it shows where you are looking even when Herdr's own focus
  was elsewhere.
- **Shell** in an agent's Town or Board peek (on a phone: Board → tap a card →
  **Preview**) opens its room's floating shell, on either runtime. On Herdr it
  toggles the [Herdr Float](https://github.com/meerzulee/herdr-float) plugin
  in the agent's Space and folder, exactly as `Ctrl+Alt+F` does; without that
  plugin installed in Herdr, World shows Herdr's refusal. On herdr-core, which
  has no plugins or popups, World runs its own float shell instead (see
  herdr-core connections below).
- Switch back to a recently viewed pane without waiting: the service keeps up
  to 20 recently viewed terminal streams open for 10 minutes without viewers.
  They belong to their connection's runtime and close with it.
- Relay terminal OSC 52 clipboard writes. Herdr 0.9.0 follows the foreground
  recipient, not proven originating-pane ownership; see
  [clipboard compatibility](docs/DEPLOYMENT.md#herdr-compatibility). A write
  made by a command that a composer sent returns to the browser that sent it,
  on the same connection and terminal. Clipboard reads stay refused.
- `Cmd/Ctrl`-click HTTP(S) links to open safely in a new tab, or workspace-relative
  / absolute paths to preview text, Markdown, or images. Wrapped paths remain
  one link, including indented continuations in agent output. Windows drive and
  backslash paths are recognized too. On Herdr 0.9.1, wrapped terminal links
  resolve against visible rows; OSC 8 links retain their explicit destinations.
  Older Herdr versions keep local URL/path detection.
- On a touch screen, long-press a link or path and choose **Open link** or
  **File actions**. This works in every view's terminals, while an agent keeps
  repainting its status line and while the Composer is open. A URL found in the
  text stays offered while its row shows the same text; a labelled OSC 8 link
  is withdrawn when a new frame arrives. These actions work in Town and Board
  managed Inspectors as well as Spaces, including with Composer open. Progress
  on adjacent hard rows does not expire an unchanged URL. Repeated window
  activation preserves a freshly verified OSC 8 target only at the same cells
  and frame.

## Settings

**Menu** holds what you do every day; **Settings** holds everything else, with
one search. Paths in this file such as **Settings → Theme** name a row you can
also find by typing its name.

- **Menu** lists **Settings**, **Find or act**, **Zen mode**, **Help**,
  **Upgrade** (only when one is offered) and **Log out** (only when World asks
  for a password). **Help** opens Settings at its Help tab.
- **Menu → Settings** lists every setting and command under **All** and nine
  tabs: Appearance, Town & views, Notifications & sounds, Agents, Keyboard,
  Integrations, This World, Commands and Help. Each row names where it applies
  (this browser, all browsers, one connection) and, for a control that also
  lives on a view, where (Town's sun button under **ALL**). Arrow keys move
  between tabs; Tab stays inside Settings.
- Most rows change in place. **Open** shows a page inside Settings (**Read
  replies aloud**, **World name**, **Worktree command**, **Terminal
  transport**, **Integrations**, **Herdr and connection details**), where Back
  or Escape returns to the list, or opens a dialog (**Layout**, **Terminal
  colours and font**, **Keyboard shortcuts**, **Phone terminal keys**,
  **Automatic branch updates**) that returns to Settings at its row when
  closed. **Agent profiles** and **Chimes and who plays them** open their own
  windows.
- Controls that stay on a view are rows too: **Board surface**, **Board status
  colours** and **Board status pulses** switch to Board and open its settings
  menu or colours; **Town lenses** switches to Town and opens the lens
  chooser; **Hosts and connections** opens **Manage connections**.
- **This World** holds **Herdr and connection details** (Herdr version,
  upgrade or setup, connection address), **World name**, update checks,
  **Reload page** and **Log out**. **Help** opens the tutorial, this file,
  troubleshooting, issues and the changelog in a new tab.
- **Commands** lists what Cmd+K offers for the open workspace, tab and pane
  (**new workspace** finds **Create workspace**). A command Cmd+K refuses is
  shown greyed with its reason, and runs only through Cmd+K for the active
  connection; when Cmd+K cannot act, its commands leave Settings.
- The search finds a setting by its name, its words and its choices:
  **lighting** and **night** find Town's time of day, **font size** finds the
  terminal, interface and chat sizes, **sounds** finds sound on this device,
  **weather** finds the Weather source's place and on/off.
  The control in the result changes the setting at once.
- **Cmd+K** (`Ctrl+K`) finds the same settings and commands. A choice offers
  each option (**night** → **Town time of day: Night**), a switch offers
  **turn on/off** and a size offers **larger/smaller**; Enter applies it.
- Each row's link button copies an address ending in
  **`?setting=<id>`** (for example `?setting=town.time-of-day`), or
  **`?setting=<tab>`** such as `?setting=help`. Opening it opens Settings at
  that row, highlighted. The old `?settings=next` preview switch is ignored.
- On a phone the Menu and Settings are sheets: swipe the handle down to close.
  Settings is full height; tabs scroll sideways and wide controls take their
  own line.

## Code view design preview

Code is a proposal to show the user's installed real VS Code web workbench inside
World, projecting the same hosts, rooms, projects, agents and terminals. IDEs fit
the existing integrations direction: detect and enable per host, open per project,
with desktop handoffs to VS Code, Cursor, JetBrains Gateway and Zed. The
[research and recommendation](docs/design/code-view/research.md) compare Microsoft
`code serve-web`, OpenVSCode and code-server, marketplace/settings differences,
licence, origin/authentication, SSH, terminal and resource hurdles. The
[design walkthrough](docs/design/code-view/design.md) gives exact preview clicks.
No live editor, server, extension, installer, proxy or navigation is delivered.

Open **`/code-view-prototype.html`** on your World/preview origin. The standalone
**DESIGN STUDY / 981** uses a clearly labelled VS Code **stand-in**, an IDE picker
and an **Open in desktop IDE** handoff preview. All data/actions are synthetic;
nothing installs, connects, saves, executes or launches an app. **Block embedding
(mock)**, **Disconnect host (mock)** and the SSH host's missing-provider fixture
expose failure states; **Mark installed (mock)** only changes fixture state.
**Attach profile (mock)** demonstrates existing agent terminals; Herdr TUI requires
acknowledging that attach resizes the pane for every viewer. The mock presents
the desktop workbench in World's frame. **Reset study** clears memory-only state.
Real embedding remains gated on upstream terms, same-origin/worker/webview compatibility and
explicit trust in full shell/write and same-origin extension authority.

## Workspace Inspector

Open Files, Changes, or Chat with the TabBar Inspector button,
`Cmd+Shift+B` on macOS, or workspace/agent context menus. The header identifies repository,
branch/worktree, and checkout path. Inspector and Annotations leave the primary
sidebar's visibility unchanged. Workspace rows show the latest PR/MR status while
keeping workspace names visible; Inspector commit navigation preserves focus and
refreshes Files after changes. PR/MR refreshes keep the current badge visible.
Badges also survive reloads and reconnects: the last known status stays visible
as stale, and not actionable, until a fresh lookup on a ready connection
replaces it. The browser keeps that cache per connection and destination, with
only what badges and links show. Badge lookups wait behind interactive
requests, and identical lookups share one answer.
A failed refresh leaves the last known result dimmed with its successful check
time; the status card marks it **Last known**. This fallback belongs to the same
host, runtime, workspace, checkout and branch; changing targets clears it. A paused branch rebase can retain
its request on detached HEAD; unrelated detached checkouts stay unresolved.

- Activating a desktop terminal preserves a docked Inspector. After prefilling
  review feedback, **Go to agent** closes it and reveals the destination terminal;
  mobile or expanded Inspectors also close on terminal activation.
- Dock right/bottom, resize, or expand without unmounting the terminal. Header
  controls restore/close; Esc dismisses transient UI, not the Inspector.
- Tab switches keep it open. Workspace switches restore the target checkout's
  view, selection, and layout. Closing returns to the originating tab if it
  exists, otherwise the active tab.
- Wide layouts show navigation beside content; narrow layouts drill into files
  with overlay/full-screen views. Resize the separator by dragging or
  Left/Right/Home/End; double-click resets it. Files and Changes save separate
  checkout-scoped widths.
- Agent browsing starts at its cwd only inside the checkout. Terminal links use
  their pane's workspace, not later focus. Changes cover the checkout, not
  proven agent ownership.
- Open closed worktrees before browsing. Missing/prunable worktrees offer cleanup,
  never sibling files. Removal clears only that checkout's resource state.
- Directory targets opened from terminal links offer a New workspace action that
  prefills the name (last directory component) and CWD, unless the directory
  already backs an open workspace.

Preview is read-only: no synthetic terminal tabs or cross-worktree merged changes.
See [resource ownership](docs/ARCHITECTURE.md#workspace-resource-ownership).

## Agent Awareness and Session Inspection

- See Herdr-recognized identity and working/blocked/done/idle status in the tree,
  pane switcher, command menu, and Agent panel. Focus panes there or through
  browser completion notifications.
- Read and reply to an agent in the Inspector's **Chat** tab, which replaces
  History. Chat reads the conversation from the agent's transcript, never the
  terminal, and hides context the harness injects as user turns. It sends with
  Herdr's agent prompt only to a session Herdr ties to the pane (a reported
  session or a Codex title thread), not to one World guessed from the folder.
  The paperclip (**Add a file**) attaches files, which upload to the pane's
  host and add their paths to the message. Enter adds a line; the paper-plane
  button, Ctrl+Enter or Cmd+Enter sends.
  A sent message shows as not yet seen until its session's transcript has
  the same words, and then as matched by its words, never as delivered.
  When there is evidence it went to another session, a red notice names both
  sessions and pauses Send until dismissed; when Chat can no longer check, it
  says so, or that it cannot tell when the same words appeared at about the
  same time. All slash commands use Chat's shared Compose editor and have
  **sent, not checked** receipts until their text appears in the transcript.
  Claude Code's `!` and `#` modes still use the Terminal.
  A Now bar shows the agent's status, its current task from the terminal title
  and how long it has been at it, with Stop (or Esc twice) for Claude Code,
  Codex and Pi; the step running now shows with its command and timer.
  Harness task titles omit animated spinner glyphs even after a letter or name
  prefix. On Herdr TUI connections those frames alone do not refresh Chat;
  changes to the task text, status or conversation still do.
  When the agent waits on a permission prompt, a question (one or several,
  with each choice's description) or plan approval, Chat shows it as an ask
  card and answers with the option you pick (click or its number key), after
  checking the question has not changed. A form of several questions lists
  every question's header with whether it is answered, asks them one at a
  time, and then offers **Submit answers** from its review. Codex question
  dialogs offer numbered choices without approval key hints. Claude Code's
  **Type something.**, **Chat about this** and plan feedback offer a text field
  and **Send text answer**, with the native destination checked before sending.
  Each tool call's row in Chat carries its evidence: a plain label, its state
  and time, a pass or fail badge for a test run, and when opened, the edit's
  diff, the test strip with its first failure, or the end of its output.
  It refreshes when the service sees the transcript, title or status change,
  without browser polling, and keeps the last good view if a read fails. When
  it cannot read the conversation it shows the reason with the matching action:
  copy the integration command, link a Codex session, **Refresh** or **Open
  Terminal**. **Details** opens the History view below. See [Chat](docs/CHAT.md).
- Inside the scrolling conversation, Chat shows the current quest as one
  collapsed title/progress row. Expand it for the progress bar and objectives
  as pending, active, done or blocked,
  read without a model from the harness's own todos (Claude Code `TodoWrite` and
  tasks, Codex `update_plan`, Kimi `SetTodoList`), approved plan, Codex goal or
  `/loop`. See [Quests](docs/CHAT.md#quests).
- In Details, switch between **Chat** and **Timeline**. Chat pairs tool calls
  with results and shares Ranger's conversation minimap; Timeline keeps individual
  records available. Use **Link Codex session** to preview a full conversation UUID
  and confirm its association with the foreground Codex pane. This replaces the
  existing link for all viewers. Codex lookup searches active and archived records
  on the selected local/Unix SSH runtime; Windows SSH history remains unavailable.
  For shared-daemon Codex panes without a session report or thread title, one
  matching pane and one loaded thread can provide a recent, read-only guess.
  Ambiguity shows no conversation. Add **Thread ID** with `/title`, link the
  session explicitly, or use the Terminal to reply or answer permissions.
- Details' **Chat** view has a terminal message box sharing the pane's Message
  draft. Paste images or choose **Add images**; uploaded paths stay in the draft
  until sent. Desktop Enter sends and Shift+Enter adds a line; touch Enter adds
  a line and **Send** sends. A working, blocked or unknown agent first requires
  **Send anyway**. This types into the selected terminal and has no Chat receipt.
  The primary Chat tab keeps its session-binding and permission-answer checks.
- Details' **Chat** view can read an agent reply aloud with **Speak**. Unless
  you choose a voice in **Settings → Read replies aloud**, only an
  on-device voice is used. A network voice, labelled there, can send the reply
  text to the browser vendor and is used only when chosen. A saved voice that
  disappears falls back to an on-device voice, never a network one, and a
  browser without one says so instead of speaking. The same settings set the
  speaking rate; playback may stop while the browser is in the background.
- Codex launch commands default to `codex --no-daemon`, so integration hooks
  inherit the selected pane's environment. Install the Codex integration on that
  host and resume existing shared-daemon conversations in this mode. See
  [Codex launch guidance](docs/HISTORY.md#pane-scoped-codex-launches).
- Open Details with independent User/Agent/Tool filters (User/Agent enabled,
  Tool hidden initially), a message minimap, and on-demand tool details. The recent window
  counts 200 conversation entries, not associated tools; exports remain complete.
  See [History synchronization](docs/HISTORY.md).
- Choose **Agents: Separate** at the bottom of Workspaces for a dedicated panel,
  keep agents nested, or pick **Agents: Compact** to hide agent rows and always
  show each workspace/worktree tab count instead. Separate defaults to
  **Attention first**: blocked,
  done, working, idle, unknown. Sort/Group icons offer workspace/manual order
  and status/workspace/type groups with collapse controls. Ungrouped manual
  order supports dragging. Sort/group preferences are browser-local; manual
  order is per connection. Idle agents sort by newest session-file activity
  reported by the bridge, with Herdr state-change sequence as a fallback.
  Recency survives refreshes and completion acknowledgements without browser
  activity tracking; manual and workspace order stay unchanged.
- Rows show tab names before pane IDs; blank or numbered defaults (`2`, `Tab 2`)
  are omitted in both views.
- Inspect turns, tokens, update time, session ID/file, and other metadata. Session
  Inspector offers Timeline, searchable ATIF/raw transcripts, and original-file
  or normalized ATIF export.

Readers exist for **Codex, Claude, Kimi, Grok Build, Pi, Oh My Pi, Muse Code, Antigravity CLI**; Codex,
Claude and Pi are checked against real transcripts (see the [harness matrix](docs/CHAT.md#harness-matrix)). Missing Herdr integration metadata shows the integration command.
Codex 0.157 and later run conversations in a shared background service, so
Herdr's hook cannot say which pane shows which one. Run `/title` in Codex and
add Thread ID: History then reads the conversation from the pane's title, and
shows nothing rather than guess when the title does not identify exactly one.
With `--ssh-host`, Herdr-reported paths and Claude, Pi and Codex ID lookups read remotely.
SSH Claude lookup requires a unique UUID match under that host's
`CLAUDE_CONFIG_DIR/projects`, or `~/.claude/projects/` when unset;
missing or ambiguous transcripts never fall back to this machine's files. Other
ID/directory fallbacks (including Grok Build and Antigravity CLI discovery) remain local and need
locally accessible transcripts.

## Git Worktree Lifecycle

- Create a linked worktree from freshly fetched `origin/main` without changing
  the source branch or dirty files; a repository without an `origin` branches
  from its checked-out commit. Discover/open existing worktrees.
- See checkout paths, open/closed state, branch status, and uncommitted counts.
- Focus open worktrees, run `git pull`, or enable per-checkout branch updates.
- Remove linked worktrees with confirmation, hooks, process cleanup, and recovery
  that preserves residual files when safe removal fails.

Open **Worktree Lifecycle** from a workspace context menu or search
`worktree lifecycle` in the command menu. In World's navigator, repository
workspaces offer the same button and create/remove menu entries on desktop and
phone; a stale or failed host shows them but leaves them inert. The workspace
list clips long worktree and branch names at the start, so their distinctive
end stays visible.

Each repository can choose where its new worktrees go with **Worktree
location** (workspace context menu, command menu or Worktree Lifecycle); empty
keeps Herdr's default. **Settings → Worktree command** sets a **New
worktree command** and a **Remove worktree command** that run from the source
repository on the workspace's host instead of Herdr's own creation and
removal; after a removal command, Herdr closes the workspace. `{path}`,
`{branch}`, `{base}` and `{repo}` are replaced shell-quoted, and `{force}`
becomes `--force` for a forced removal. A repository's own **Worktree
command** and **Remove command**, set in Worktree Lifecycle, win; leave them
empty to let Herdr do it. These settings belong to the workspace's connection.
Ranger can run a configured command but never set one.

### Paseo Worktree Hooks

Define [Paseo hooks](https://paseo.sh/docs/worktrees) under `worktree` in the
repository's `paseo.json`:

```json
{
  "worktree": {
    "setup": "bun install",
    "opened": "./scripts/worktree-opened.sh",
    "teardown": "./scripts/worktree-teardown.sh",
    "removed": "./scripts/worktree-removed.sh"
  }
}
```

| Paseo hook | When Herdr World runs it | Working directory |
| --- | --- | --- |
| `setup` | After a new linked worktree has been created and opened | New worktree |
| `opened` | After an existing linked worktree has been opened | Opened worktree |
| `teardown` | Before a linked worktree is removed | Worktree being removed |
| `removed` | After removal finishes | Source checkout |

For `setup`, `opened`, and `teardown`, the target checkout's `paseo.json` wins;
only an absent file falls back to the source checkout. After removal, `removed`
normally uses the source configuration because the target no longer exists.

Commands run through `sh -c`. The following variables are available:

| Variable | Value |
| --- | --- |
| `PASEO_HOOK` | `setup`, `opened`, `teardown`, or `removed` |
| `PASEO_CHECKOUT_PATH` | Target worktree path, including the former path for `removed` |
| `PASEO_SOURCE_CHECKOUT_PATH` | Parent/source checkout path when known |
| `HERDR_WORLD_HOOK_EVENT` | `worktree.created`, `worktree.opened`, `worktree.before_remove`, or `worktree.removed` |
| `HERDR_WORLD_HOOK_CHECKOUT_PATH` | Same target path exposed under a `HERDR_WORLD_`-prefixed alias |
| `HERDR_WORLD_HOOK_SOURCE_CHECKOUT_PATH` | Same source path exposed under a `HERDR_WORLD_`-prefixed alias |

Notices show hook outcomes and bounded diagnostics (exit code, stderr, or error).
Failed `teardown` stops removal: fix/disable the hook before retrying. Other hooks
are not transactional: failed `setup`/`opened` does not undo creation/opening;
failed `removed` cannot restore a worktree.

Hooks default to enabled. Disable them per repository in **Worktree hooks** or
**Worktree Lifecycle**, which also show detected configuration and commands.
With `--ssh-host`, configuration and execution are remote. **Hooks are trusted,
unsandboxed code:** review `paseo.json` before creating, opening, or removing.

### Automatic Branch Updates

Fetch `origin/main` and merge into enabled checkouts' current branches every
10 minutes by default. The UI shows interval and last result. Manage saved
per-checkout settings in **Settings → Automatic branch updates**, workspace context
menus, or Worktree Lifecycle.

Runs skip dirty or detached checkouts, verify branch/HEAD/worktree stayed unchanged
during fetch, and abort conflicting merges. Updates run only while the workspace
is open in the current connection.

## File Explorer and Preview

- Browse a cached, expandable tree, optionally including hidden files. Search
  loaded names/paths by substring or glob: `r*md`, `?.txt`, `[abc]*`, `{md,mmd}`,
  and `**` are supported. Patterns with `/` match loaded paths; matching is
  case-insensitive. Git badges mark changed files/directories; ignored files
  are dimmed.
- Choose **Browse filesystem** in the toolbar to opt into read-only browsing
  outside the workspace on the connected host. Use **Parent directory** or enter
  an absolute directory to preview references, copy paths, or download files.
  **Workspace only** restores the tree. This mode is off by default and resets
  on browser refresh or checkout/connection changes.
- Preview text with line numbers, syntax highlighting, and `Cmd/Ctrl+F` search.
  Use **Refresh preview** beside Copy to reload the current file from disk
  without reopening it; the selected Raw/Rendered mode is preserved.
  Markdown offers Raw/Rendered views with Mermaid diagrams in code fences.
  `.mmd`/`.mermaid` files offer Diagram/Source views and accept leading comments,
  document headers, and Mermaid fences. Diagrams have independent zoom, Fit, and
  100% controls; scroll to pan or use Ctrl/Cmd + wheel to zoom.
- Follow Markdown file links within the Inspector: relative to the document,
  leading `/` from workspace root, and heading fragments within the destination.
  For absolute reference files, links resolve from the file directory and
  leading `/` resolves from the filesystem root.
  External links open a new browser tab.
- Preview SVG, PNG/APNG, JPEG, GIF, WebP, BMP, ICO, and AVIF images with zoom and
  Fit controls, plus PDFs and workspace-local Markdown images. Phones and other
  browsers without a PDF viewer draw a PDF three pages at a time, with Previous
  pages and Next pages. Unsupported binaries remain download-only; image
  decoding depends on the browser.
- Drag uploads onto the root/directory. Download files or workspace-scoped
  `.tar.gz` directories; copy absolute paths; delete with confirmation.
  Open actions by right-click or touch long-press.

File operations and previews work locally and over SSH.

## Review Annotations

- Open **Annotations** independently next to **Inspector** in the workspace bar (or
  the narrow-screen view switcher). The panel stays available when Inspector is
  closed and opening it does not change Inspector's view. The tab shows the
  current checkout's comment count, including saved drafts. Use the tab or
  Annotations shortcut to toggle the panel, or its close button to dismiss it.
- Desktop annotations float over the workspace by default.
  **Pin annotations** switches to a fixed layout beside or below the workspace;
  **Float annotations** restores the overlay. The choice stays in this browser.
  Mobile uses an explicit Annotations surface with touch controls.
- Click/drag diff line numbers or source annotation gutters to comment on lines;
  release opens the editor with file, range, and content snapshot.
- Select rendered Markdown passages to capture their text and nearest heading.
- Select terminal text with the mouse, then choose **Add comment** to capture
  the passage and pane label, even with the Inspector closed. Terminal quotes
  have no buffer coordinates and are not re-anchored; missing panes are marked
  unavailable.
- Edit, delete, or reorder mixed checkout-scoped comments. Copy compiled feedback or
  pre-fill a selected Agent pane; **delivery never submits**. Review and press
  Enter manually. After pre-fill, **Go to agent** opens the destination pane/tab.
- Copy retains the browser-local draft. Successful pre-fill removes only unchanged,
  delivered comments; edits made during delivery and failed deliveries retain work.
  Leaving the draft's workspace or connection during pre-fill retains the original draft,
  even after returning. Closing Inspector or Annotations does not discard drafts.
  Blank comments cannot be delivered.
- Refresh re-anchors matching file/diff content and marks unresolved anchors stale
  without losing captured quotes.

## Diff Viewer

- Browse a directory tree with staged, unstaged, untracked, conflicted, and
  branch-diff badges plus added/deleted counts.
- Choose **Working tree**, **Against branch**, or **Last step** (latest completed
  agent-activity snapshot, including commits/untracked files; not proof of ownership).
  Branch mode uses the repository's recorded default, then its configured default,
  main or master. Select a local or remote-tracking branch already present on the
  host; inspection never fetches. The choice is saved per repository and host.
- Read files in repository order. Large, truncated, and `linguist-generated=true`
  diffs start collapsed and render on expansion.
- Choose desktop side-by-side/unified views; mobile is unified. Wrapping saves
  independently for desktop/mobile. Search with `Cmd/Ctrl+F`, Enter/Shift+Enter,
  or previous/next controls. Text is syntax-highlighted; images have previews.
- Jump to File Explorer from a diff. Working-tree context menus (right-click,
  long-press, or keyboard menu key) offer open, copy relative/absolute path, and
  status-matched stage, unstage, mark resolved, discard unstaged, or delete
  untracked actions, with destructive-action confirmation.
- **More Git actions** (`…`, beside Refresh) offers Stage All, Unstage All,
  Discard All Unstaged, and Delete All Untracked with affected-file counts.

Scope, view mode, wrapping, and recent selection persist per checkout/browser.
Git actions recheck status/content and reject stale menus instead of destroying
newer work.

## Mobile and PWA

- Town Chat controls have 44 × 44 px touch targets on phones, including
  buttons drawn smaller than their tap area.
- In an ordinary mobile shell terminal, **Agent terminals** beside Message
  launches an agent in that pane with Enter. Start with an empty shell prompt
  and draft. The pencil edits each command, including arguments or an executable
  not detected on the host; preferences stay in this browser per connection and
  agent. **Reset** restores the detected default. A failed send keeps the command
  in Message. Existing agent and pad terminals do not offer the launcher.
- List panels use the command picker's borderless rows, compact headings and
  selection highlights. World's shared top app bar and managed-window Tabs
  sheet keep their existing navigation and window-restoration behavior.

The Message editor sits below each terminal in normal layout flow. Tap it to
raise the keyboard and compose; Direct explicitly enables raw terminal input.
Tabs and More stay in World's shared top app bar. If an upload finishes after its
Direct destination retires, World keeps the path in the original Message draft
and reports the failed insertion instead of sending it to another pane.

- Responsive terminals, Inspector, and viewport/keyboard handling. **Settings →
  Appearance → Layout → Display mode** offers Automatic/Mobile/Desktop.
  Automatic uses **Mobile up to (px)**: 768 by default, adjustable 320–2560 CSS
  pixels. Mobile stays mobile at any width, including after reload.
- URL overrides `?layout=mobile`, `?layout=desktop`, or `?layout=auto` beat saved
  mode. Choosing a menu mode clears that override, preserving other parameters.
- Choose **Agents on top** or **Workspaces on top** independently for each layout
  under Layout Preferences. This affects the separate Agents panel; mobile defaults
  to agents first, desktop to workspaces first.
- Touch taps and swipes read terminal output without opening the device keyboard.
  Use the bottom-right **Open device keyboard** button to type directly; a light
  touch tap on the terminal dismisses it without sending input. Scrolling keeps
  input active. Mouse selection and physical-keyboard input work in either layout.
- Long-press a word directly in the terminal, drag either selection handle, then
  **Copy** or **Add comment**. Copy keeps the selection; **Done** or Escape returns
  to reading without opening the keyboard. Scroll before selecting older output:
  touch handles cover the displayed viewport. Output stays connected and the
  displayed frame freezes until selection ends, then shows pending output.
  Legacy incremental streams resume automatically at a 1 MiB buffered UTF-16
  payload limit without discarding output or a captured comment.
- Configure the floating terminal panel's `2×8` shortcut grid and up to four
  side buttons. Empty editor slots keep their positions but compact at runtime.
  Actions include Ctrl, arrows, Enter variants, full/half-page scrolling, and
  Paste (text or uploaded clipboard-image paths).
- Switch split panes or use the Tabs sheet to create/switch/close tabs when the
  strip is hidden. The composer supports native IME, dictation, multiline text,
  and images: **Insert** does not execute; **Send** adds exactly one Enter.
  Drafts stay in memory per connection/pane; closing their pane/tab/workspace
  asks before discarding them.
- A bundled glyph-only Nerd Font supplies common terminal icons. Install as a
  PWA in iOS/iPadOS Safari, macOS Safari, Chrome, or Edge to remove browser chrome.
  It still needs a reachable Herdr World process, not offline access. Use **Settings →
  Reload page** in the browser or PWA.

Mobile shortcuts and appearance stay in this browser, not Herdr configuration.

## Shortcut cheat sheet

On desktop, open the searchable, read-only overview of your active shortcut preset
with Cmd+Shift+K on macOS or Ctrl+Alt+Shift+K on Windows/Linux, the top-bar command
icon, Actions, or Settings → Shortcut cheat sheet. Numbered actions collapse into 1–9
rows. Customize assignments in Settings → Keyboard shortcuts.

New workspace and worktree dialogs suggest readable two-word names. Suggestions
load asynchronously; editing the name takes precedence over a late suggestion.

New room (New workspace) picks its **Folder** on the chosen host, Herdr TUI
and herdr-core alike:

- **Recent folders** are up to six buttons, by name with the full path as a
  tooltip: the folders that host's panes and rooms work in, the focused pane's
  first, then the most recently active. The folder defaults to the most recent
  one, else `~` (home); one tap on another recent folder, then **Create**,
  makes the room there.
- The folder is checked on the host as you type: it shows the resolved path,
  **Up to <parent>** and its subfolders to browse, or the error. **Tab**
  completes a typed path to the shared start of the matching folders. Create
  waits for the check of a typed folder; the default folder does not.
- A herdr-core room keeps its folder: core checks it on its host, refuses a
  missing one, and starts the room's shells and agents there. App spaces and
  worktree rooms keep their own folders.

## Remote, Multi-Client, and Operations

- Manage shared local/SSH profiles with independent browser selection. A
  browser starts on the connection it last used while that connection still
  exists, otherwise on the service's default; phones still open on Town.
  Disconnect does not stop Herdr/workspaces. A Linux/macOS World service can reach Unix or Windows SSH hosts;
  a Windows World service supports local profiles. See [connection setup](docs/DEPLOYMENT.md#local-and-ssh-connections).
- **CLI connection changes apply immediately.** `herdr-world connections add`,
  `remove` and `set-default` apply through the running service on loopback, in
  the same queue as **Manage connections**, retaining concurrent Settings edits.
  Auto-connect additions connect at once; removal retires only that host's
  runtime and open contexts. Other connections and browser sessions stay open.
  Choose another default before removing the current one; explicit service
  Herdr settings still pin the process default. `--restart` remains optional
  on loopback for the installed service; omit it for a development or preview
  World. `HERDR_WORLD_DATA_DIR` selects the data folder; its live instance lock
  records the actual service address, and the CLI uses that folder's own token.
  `HERDR_WORLD_URL` and `HERDR_WORLD_TOKEN` cannot redirect these edits, and a
  service owning another registry refuses them. A managed service bound to one
  non-loopback address still needs `--restart`: it stops the service, saves
  offline, then starts it again even if the edit is refused. Stop a foreground
  process there before editing.
  An unreachable live owner, refused edit or unreadable HTTP reply names the
  target service and gives recovery steps, without an offline retry. Check that
  World's data folder, address and live catalogue before retrying, or stop it
  before editing offline. Offline commands serialize the whole read/edit/save,
  so successful unrelated edits survive concurrent CLI commands. Service startup
  and first-run discovery share that ownership; a starting or busy owner can
  refuse an edit without writing. Ownership follows the registry even across
  data folders, survives process pauses and releases automatically on process exit.
  Keep the private `connections.json.ownership.sqlite` sidecar in place; never
  delete or replace it to bypass a busy owner. With no live owner, edits are saved
  for the next start; for older services without locks, the installed service's configured address
  is still checked. Validation errors exit 2; persistence and service failures exit 1.
- Remote file/image-paste/Git/hook operations run on the same host; session
  inspection has the metadata limits described above.
- **herdr-core connections.** Open **Hosts → Manage connections → Add
  herdr-core** for this computer, a Unix SSH host or a Windows SSH host.
  Set the session (`default` unless you changed `HC_SESSION`). Set a state
  directory only if core uses a custom `XDG_STATE_HOME`. World reads
  `core.lock` on every attempt and opens that existing socket or named pipe;
  it never starts core during connection or retry. Unix socket directories
  must be private (0700). Windows needs PowerShell and SSH key login; the
  pipe must be accessible only to your account, SYSTEM and Administrators.
  Start core without elevation so the SSH account can open it.
  The card shows the version and live terminals. **Hosts** filters core and
  Herdr TUI buildings together. A stale core keeps its last topology for
  reference and refuses actions until fresh observation succeeds.
- **Core-only setup.** Without the Herdr TUI installed, the first core
  connection becomes the default and Town shows only its building. With the
  TUI installed, its Local connection remains the default and core is added
  beside it. This saved default differs from the launcher preference: new
  agents prefer a connected core. **Add Local** and
  `herdr-world connections set-default <id>` remain available.
- **Install or start core.** **Manage connections** offers **Install
  herdr-core…** for this computer and saved Unix SSH hosts without a ready
  core. Town's **Set up herdr-core** and a stopped core connection offer the
  same flow. Review the version, location and login startup, then confirm
  **Install and start**, or **Start and connect** for an installed core.
  Existing runtimes are never replaced or updated. Progress stays available
  after closing the dialog; a failure gives a reason and **Try again**.
  Success means the connection is ready. Custom state directories need a
  manual start; Windows SSH installs are manual. See
  [runtime setup](docs/DEPLOYMENT.md#herdr-installation-and-upgrades).
  If the card says **stops at logout**, run its displayed
  `sudo loginctl enable-linger -- <user>` command on that host.
- **Core rooms and launches.** Core agents appear in Town, Board, Desk and
  Needs you. App-placed agents share rooms from their app space/tab labels;
  subagents join their parent's room; others use the core's main room.
  **New agent** defaults to core when ready. Choose a TUI room to use that
  runtime. Profiles resolve an installed executable on the selected host;
  installation and harness sign-in remain yours. Claude and Codex receive
  their first task as a launch argument. Other harnesses receive it only
  after core reports the original foreground program idle. An unreported
  trust prompt receives nothing: World says the agent started without its
  brief; review Terminal and send it through Chat. A lost launch reply may
  mean it started; a lost brief reply means the brief is uncertain. Neither
  automatically repeats. Core currently has no harness login tab.
  **Terminal** starts an unplaced plain shell. World-started agents appear
  in Herdr apps and are kept by core; closing their app pane ends them.
  **Add room**, **Rename** and **Close** manage World's rooms; app-created
  rooms stay the app's to rename or close.
- **Stop core agents.** The bin and **Close room** list the programs and
  descendants that will end. An observed replacement or new child invalidates
  confirmation and shows a fresh list. A child created during the native
  kill can still end; the result names it. See the
  [runtime limits](#runtime-limits).
- **Core Chat and asks.** Open an agent for the shared **Chat**, **Terminal**,
  **Files** and **Changes** window. The Agents open setting applies to both
  runtimes. **Open chat** selects Chat; an ordinary open shows Terminal until
  a conversation can be read, unless you choose a tab yourself.
  Chat uses the same transcript readers as the TUI. Claude's live process
  record, launch/resume arguments or an explicit session link identify the
  conversation. Directory discovery is marked as a possible guess. Pi's
  `/new` needs a new reading link. **Link a conversation for reading** accepts
  a session ID or absolute transcript path on the host; the link ends when
  Chat closes and never changes where input goes. **Refresh conversation**
  reads the latest 200 entries, with disclosed shortening above 16,000
  characters per entry or 256,000 total. A changed host, program, foreground
  or title discards the read. See the [harness inventory](docs/core-harnesses.md).
  Messages, answers, **Stop** (Esc) and keys use core's native input, including
  harnesses without transcript readers. Missing recipient evidence refuses
  input and asks you to reopen Chat. An unanswered possible send stays
  **Uncertain**, never automatically repeated.
  `herdr-world ask` inside a verified local Linux core terminal can receive
  its saved answer after three seconds without a CLI acknowledgement.
  Replaced programs, reconnects and World restarts retire that binding;
  `ask get` still retrieves the stored answer. Remote or ambiguous callers
  remain unverified and use retrieval only.
- **Shared seen and pins.** A foreground, focused peek or agent window held
  for about half a second marks a core turn seen in Herdr apps too. Lists,
  minimized windows and background pages do not. If an app marks it unread
  during that look, World waits for another turn or a new look. Label sharing
  is best effort; core has no atomic compare-and-set.
  Core's pin is shared with Herdr apps. Pinning a desk pins its agents (or
  terminals if none are agents); unpinning clears every terminal in the tab.
  Pinned desks and cards go first; offline hosts show their last pins and
  refuse changes. TUI pins and **Mark reviewed** stay World-only.
- **Core files, changes and worktrees.** Files and Changes follow the
  program's current folder and Git worktree, using World's tools on that
  connection's Unix host. A replaced program asks you to refresh. A core
  room's **Worktrees…** offers **Create**, **Open** and **Remove this
  worktree…**. Creation uses origin's freshly fetched default branch (or the
  checked-out commit without origin), the repository's worktree location and
  its configured command. Paseo hooks work as for TUI worktrees. Removal
  confirms the programs that end, runs teardown, ends them, then removes the
  checkout. A failed hook ends/removes nothing; a failed Git removal keeps
  the room for retry. Opening the repository's main checkout as a room never
  makes it removable. Ranger reads core rooms and can create worktrees and
  send previewed prompts; its screen/history limits are
  [above](#runtime-limits). Scheduled tasks refuse a wiped or replaced core.
- **Core terminal.** Its Terminal tab holds a readable size while no Herdr
  app pane holds it; a passive watch never sends resize. When an app holds
  the size, World scales the drawing to at least 85% and scrolls the rest.
  The line under the name says whose size it is. Typing takes the size by
  core's rule; typing or clicking the app pane takes it back. Keys queued
  while opening arrive once, in order. Failed input drops later queued keys;
  nothing is replayed. Terminal replies go only after you type there.
  Switching Inspector tabs keeps its viewer; closing, minimizing or hiding
  the page releases it. A disconnect or replacement ends input with a
  reason. When core returns, an open view watches again. The limits are
  four watches per page and 32 per service; a slow browser holds output
  until it catches up. A core missing resize notifications is refused.
  On phones, the composer, key rows and uploads work as on TUI terminals.
  Uploads go to the core host; Windows SSH uses a private temporary folder.
  Drafts survive reopening until the connection generation changes.
- **Room shell.** **Shell** in a core agent's peek opens one shared float
  shell per room in the agent's current folder. **×**, a click outside or
  `Ctrl+Alt+F` hides it and leaves it running; **End shell** or `exit` ends
  it. End confirms any descendants first. A changed connection closes the
  view with **Open again**. World never joins a foreign terminal that has
  taken the shell's name. TUI agents use the Herdr Float plugin instead.
- **Core task summaries and stamps.** `task-summary` writes an expiring label
  on its own core terminal; `stamp CHILD PARENT` records display parentage,
  never a native parent or kill cascade. Both verify the caller's process.
- **Testing core without a runtime.** Open `?coreFixture`, then **Hosts →
  Manage connections → Fixture core (testing) → Start fixture core**. It
  creates synthetic agents and a disposable repository, with no real harness
  or core programs. Open **reviewer → Chat**, **Terminal** or **Files**;
  the **web** room offers **Worktrees…**. The fixture's controls resize an
  app pane, mark scout unread, pin scout, simulate logout loss, replace an
  agent or lose the next input reply. **Kill fixture core** shows stale
  refusal; **Remove fixture** cleans up its connection and repository.
  `?coreFixture=alphabet` uses native IDs including `t19` and `t1b`.
  For install steps use `?coreInstall=fake` or `?coreInstall=error`: the URL
  switch disappears, every step says it is simulated, and no host is changed.
  Reload to end install test mode.

- Enable local browser alerts and background Web Push in **Settings → Notifications &
  sounds → Task notifications**, which says how alerts arrive (background
  push or this page only) or why they cannot (browser permission blocked). See [push setup and troubleshooting](docs/DEPLOYMENT.md#web-push-notifications).
  Notification sync waits while a tab is hidden. If the browser temporarily
  rejects sync because the document is inactive, World retries quietly when
  the tab becomes visible or resumes; other sync failures still show an error.
  Testing only: open `?notificationSync=invalid-state` (removed immediately),
  switch to another tab, then return to World. The first sync simulates an
  inactive document; returning retries without a red sync-error notice.
  **Open agent** follows **Agents open** (Chat by default when supported,
  otherwise Terminal), after checking the notification's owning runtime and
  agent session. In Spaces it enters that owning host; a refused notification
  leaves the current Inspector open.
- **Chimes.** While a World page is open, World plays its own chime for a
  change that needs you: a sound for who (the Town master, the crew, or the
  agent's profile) and a pattern for why (needs you: two rising notes;
  for you: a soft double knock; finished: one falling note). A toast always
  says who and why, or "sender unknown" when Herdr didn't say. Changes within
  3 seconds share one chime and one "N changes" toast. **Settings → Notifications & sounds** sets
  this device's chimes and volume (per device), the Town master's and crew's
  sounds and which patterns play (all your browsers), and who the Town master
  is: only you assign it, and its needs-you chime still plays while you focus
  on other agents. A profile's **Look & sound** gives its agents their own
  chime. An agent sends you a "for you" with `herdr notification show <title>`
  and no `--sound`. While World chimes, its notifications are silent; Herdr's
  own client may still play its sound (`[ui.sound] enabled = false` turns it
  off).
  Muting this device also silences push while World is open, including just
  after enabling notifications. Changes to device settings apply across open
  tabs, and queued burst sounds obey your current sound settings.
  Missing sender metadata stays unknown and uses the crew sound.
- Multiple browsers receive pushed events. Pause/resume yours, see client counts,
  or pause others. Herdr semantic task alerts use the relevant pane when Herdr
  supplies one; pane-less alerts open World without guessing a target. Older
  Herdr runtimes use agent-status completion alerts.
- Choose light/dark/system appearance, persistent accents, and terminal themes
  per appearance mode in **Settings → Appearance → Terminal colours and font**. Built-ins
  include Solarized, Dracula, One Dark, Nord, Tokyo Night, Catppuccin, and GitHub;
  custom themes set base/ANSI colors. Themes apply live to all terminals and save
  per browser. **Settings → Appearance → Black background** uses
  pure black instead of blue-grey for the interface and terminals in the dark
  theme, from the first paint. **Text size** scales the UI from 80% to 150%,
  including mobile.
- Manage a user service from the CLI; check releases and run checksum-verified
  one-click standalone updates under a supported supervisor. Probe `/health` or
  `/healthz`. See [services](docs/DEPLOYMENT.md#user-service).
- Keep Herdr on the version this World release verified: installer replacements and updates
  bring Herdr, the Codex/Claude/Pi harness integrations and the Herdr World plugin up to
  date, and **Settings → Herdr and connection details → Upgrade Herdr** (or **Update
  Herdr integrations**)
  appears when something is behind. A running server keeps its panes through a
  live handoff when World can prove nothing supervises it (Linux); otherwise World says a restart is
  needed. See
  [Herdr installation and upgrades](docs/DEPLOYMENT.md#herdr-installation-and-upgrades).

**All listeners require login**, including loopback. World generates a persistent
token unless an 8–1024-character password is configured; 15+ characters are
recommended beyond a trusted private network. Failed logins receive a bounded cooldown. Configure [native HTTPS](docs/DEPLOYMENT.md#native-https)
or an authenticated HTTPS proxy for encrypted access. World supplies no multi-user authorization or sandboxing; read [SECURITY.md](./SECURITY.md).

## Keyboard Shortcuts

Open **Settings → Keyboard → Keyboard shortcuts** for the searchable
list and preset editor on desktop/mobile. Lists and hints show active bindings.
See the [desktop](docs/screenshots/keyboard-shortcuts-desktop.png) and
[mobile](docs/screenshots/keyboard-shortcuts-mobile.png) editors.

- **Automatic** detects macOS/iOS, Windows, or Linux/Android; explicit presets
  override detection.
- **Edit** records/types up to three alternatives, restores defaults, or unassigns
  an action. Editing built-ins creates a custom copy. Overlapping conflicts are
  rejected while ordinary typing, IME, and dialog dismissal stay available.
- **Save as** creates named presets; **Active preset** switches them. Edits save
  immediately on the World service and follow you to every browser, even
  while the selected Herdr connection is offline. A custom preset applies only
  on the platform it was written for; elsewhere that platform's defaults
  apply. **Export/Import** transfers presets as JSON; deleting a custom preset
  returns to Automatic.
- Letter/number bindings use physical keys, unaffected by modifier-produced
  characters. Recording captures only keys the page receives; choose alternatives
  for browser/OS-reserved shortcuts, including macOS tab shortcuts.

Common defaults (Linux/Android overrides follow the table):

| Action | macOS / iOS | Windows / Linux / Android |
| --- | --- | --- |
| Command menu | `Cmd+K`; `Cmd+Option+K` in a terminal or text field | `Ctrl+K`; `Ctrl+Alt+K` in a terminal or text field |
| Sidebar | `Cmd+B` | `Ctrl+Alt+B` |
| Workspace Inspector | `Cmd+Shift+B` | `Ctrl+Alt+Shift+B` |
| Expand / restore Inspector (desktop) | `Cmd+Option+Enter` | `Ctrl+Alt+Shift+Enter` |
| Annotations | `Cmd+Option+A` | `Ctrl+Alt+A` |
| Zen mode | `Cmd+Shift+Z` | `Ctrl+Alt+Z` |
| Recent pane switcher | `Ctrl+Tab` | `Ctrl+Alt+J` |
| Pane Search | `Alt+K` | `Alt+K` |
| Search the current view (Town, Board, Desk) | `/` or `Cmd+F` | `/` or `Ctrl+F` |
| Create / close tab or pane | `Cmd+T` / `Cmd+W` | `Ctrl+Alt+T` / `Ctrl+Alt+W` |
| Previous / next tab | `Cmd+Option+Left/Right` | `Alt+Shift+Left/Right` |
| Focus neighboring pane | `Cmd+Ctrl+Arrow` | `Ctrl+Shift+Arrow` |
| Split right / down | `Cmd+D` / `Cmd+Shift+D` | `Ctrl+Alt+D` / `Ctrl+Alt+Shift+D` |
| Zoom / restore pane | `Cmd+Shift+Enter` | `Ctrl+Alt+Enter` |
| Arrange Single / Cascade / Columns / Rows / Grid / Restore | Unassigned; use Actions or set custom keys | Unassigned; use Actions or set custom keys |
| Numbered tab | `Ctrl+1…9` | `Ctrl+Alt+1…9` |
| Numbered command menu action | `Option+1…9` | `Alt+1…9` |
| Workspaces | `Ctrl+Shift+W` | `Ctrl+Alt+O` |
| File Explorer | `Cmd+Shift+E` | `Ctrl+Alt+E` |
| Diff Viewer | `Ctrl+Shift+G` | `Ctrl+Alt+G` |
| Agent chat | `Cmd+Shift+H` | `Ctrl+Alt+H` |
| Search raw preview / diff | `Cmd+F` | `Ctrl+F` |
| Send composer / add review comment | `Cmd+Enter` | `Ctrl+Enter` |
| Copy terminal selection | `Cmd+C` | `Ctrl+Shift+C` / `Ctrl+Insert` |
| Terminal paste | `Cmd+V` | `Ctrl+V` (also `Ctrl+Shift+V` on Linux) |
| Open terminal links / file paths | `Cmd+Click` | `Ctrl+Click` |

Linux/Android uses `Ctrl+Alt+Shift+T` to create tabs, `Ctrl+Alt+Shift+D` to
split right, and `Ctrl+Alt+Shift+S` to split down, avoiding common Linux desktop
shortcuts for launching a terminal or showing the desktop.

Terminal copy, page/half-page navigation, and modified Enter are configurable
here. Copy needs a selection; plain `Ctrl+C` remains terminal input. Native text
editing, editor search, and shell/agent keys follow those apps. Native clipboard
gestures remain; remapped paste needs the browser Clipboard API. Touch controls
use the separate **Mobile terminal shortcuts** editor.

Esc dismisses dialogs, menus, notifications, and update banners. Tab/arrows
navigate controls. The pane switcher accepts Up/Down, Enter, or release of its
opening modifier. Diff search uses Enter/Shift+Enter for next/previous. Select in
mouse-aware apps with Option-drag (macOS) or Shift-drag (elsewhere).

## Ranger and workspace tools

- Ranger reads explicitly permitted workspaces across local and SSH connections,
  chats with a configured model, and proposes actions for manual confirmation.
  An explicit high-permission mode can execute supported operations automatically.
- Ranger can use the service account's signed-in Claude Code CLI as a provider,
  alongside the existing model providers. Its tools retain World's workspace
  permissions, connection/runtime qualification and action confirmations.
- Ranger can show a workspace or session in the asking browser's shared Inspector;
  other windows stay where they are, and unavailable targets report an error.
- Scheduled tasks can explicitly follow all authorized workspaces, including new
  ones, with a fresh captured scope for each run.
- While Ranger answers, **Steer** or Enter adds a message after its current step;
  **Queue** or Alt+Enter (Option+Enter on macOS) waits for the next answer. Up to
  eight waiting messages can be edited or removed. Stop, failure or a chat switch
  holds them until **Send next**. A replaced runtime requires a refreshed scope.
- When the model provides reasoning, a collapsible **Thinking** section shows it
  above its reply. Selecting Ranger text is preserved while terminals repaint.
- Background tasks run once, at intervals or daily, with separate conversations
  and optional monitoring alerts. Saved schedules retain endpoint and workspace
  identity; interactive requests capture their runtime generation.
- Inspect Git commit history, keep file-preview tabs, pin and reorder native tabs,
  and move or swap panes within their owning connection.
- Configure terminal fonts and direct/composer input, upload files to the captured
  host, and set a distinct browser instance title.
- Login is required on localhost and other listeners, using a generated token or
  a configured 15–1024-character password, with throttling for failed attempts.

## Latest upstream additions

- Read local Oh My Pi transcripts, Pi directory-inferred history in read-only mode,
  Claude continuation transcripts and queued-message state. SSH transcript reads
  reuse cached bytes and fetch appended text while keeping World's history bounds.

- Ranger workspace/agent mentions, quick model and thinking controls, task-management
  previews, guarded close actions, and clearer settings/chat history.
- Windows Herdr 0.9.1+ hosts over SSH from Linux/macOS World, with native terminal
  and workspace actions. Unix-only remote file and Git tools remain unavailable.
- Optional private-network PIN login with independent session signing and recovery.

## SSH responsiveness

SSH runtimes share a private command connection while terminal transport stays
independent. Background reads leave command slots available for interactive work;
Git status refreshes in the background, and large untracked-file lists avoid a
command per file. Stalled sessions end through keepalives. See
[SSH setup and operator controls](docs/DEPLOYMENT.md#ssh-command-sharing-and-port-forwards).

## Weather source

- **Optional and shared:** Weather is off by default. Open Settings → Integrations
  → Sources → Weather → Settings to configure it, or search Settings or Cmd+K
  for **weather** (or **location**) to reach **Weather place and source**, the
  row Town's sky button links to (`?setting=integrations.weather`).
  **Connect** turns it on and **Disconnect** turns it off. Only turning it on permits Open-Meteo requests.
  A typed place name goes to its geocoding service; city-level coordinates go to its weather service. No account
  or key; the free API is for non-commercial use.
- **One location:** type a city/country or latitude, longitude. Typed input always
  wins over the optional browser fallback. **Use browser location** requests
  permission once only when pressed; no automatic prompt, tracking or watch.
  Coordinates are rounded to 0.1° before storage/sending. Settings are service-owned
  and shared across devices, including a remote browser.
- **Bounded observations:** current model conditions and at most six upcoming
  hours, cached in memory. Demand-driven refresh at most every 15 minutes per
  configuration, including Refresh Sources; six-second total deadline, 32 KiB per
  response. Reads never wait. Failure clears weather; cached conditions expire
  after 30 minutes. World keeps running with weather unavailable.
- **Limits/refusals:** one place, first geocoding match, no long forecasts, custom
  provider hosts, keys, multiple locations or Town drawings. Invalid coordinates,
  over-120-character/control-character text and unknown settings refuse before
  saving. Disabling aborts pending reads; their late results cannot return.
- **API/CLI:** a small normalized value (condition, relative intensity, Celsius,
  local day/night, valid/read time or unavailable) is in the Sources store and
  `GET /api/world/weather`. `herdr-world weather [--json]`, `weather location
  "City"`, `weather on|off` share settings; CLI reads alone may wait six seconds.
  [Weather guide](docs/weather.md) describes fields, attribution, precision,
  cache/outage behavior and a development-only unavailable fixture.
