# runtime-federation notes

[Contract](spec.md). Navigation and usage guidance; contracts live in OpenSpec.

**Surfaces:**

- Manage connections, Hosts filter, aggregate observations and focused runtime acquisition.

**Code:**

- `server/src/notifications/herdr-notification-listener.ts`
- `server/src/notifications/web-push.test.ts`
- `server/src/world/focused-acquisition.ts`
- `server/src/world/focused-acquisition.test.ts`
- `server/src/world/snapshot.ts`
- `server/src/world/snapshot.test.ts`
- `server/src/connections/registry-ownership.ts`
- `server/src/connections/profiles.ts`
- `server/src/connections/first-run.ts`
- `server/src/cli/connections.test.ts`
- `server/src/connections/registry-process.test.ts`
- `server/src/cli/connections.ts`
- `server/src/cli/connection-service.ts`
- `server/src/service/connections-cli.test.ts`
- `server/src/service/connections-cli-instances.test.ts`
- `server/src/cli/connection-service.test.ts`
- `server/src/connections/manager.ts`
- `server/src/connections/manager.test.ts`
- `server/src/connections/host-service.ts`
- `server/src/connections/host-discovery.ts`
- `shared/hosts.ts`
- `server/src/connections/host-service.test.ts`
- `server/src/connections/host-discovery.test.ts`
- `server/src/service/host-connections.test.ts`
- `server/src/world/host-snapshots.test.ts`
- `server/src/connections/local-discovery.ts`
- `server/src/connections/first-run.test.ts`
- `shared/herdrIdentity.ts`
- `shared/herdrIdentity.test.ts`
- `server/src/connections/`
- `server/src/world/`
- `server/src/adapters/`
- `shared/`

**Pitfalls:**

- Connection identity and generation cannot fall back to another runtime.

## Usage reference

- **Per-host Herdr identity.** **Manage connections → Check version again**
  reads the selected card's running server version and protocol. Compatibility
  expires after one minute; failed or disconnected checks remain unknown.
  The installed binary is separate and unknown. Upgrade is explicitly unavailable
  until its target and safe handoff are verified; no remote update runs.
## Remote, Multi-Client, and Operations

- Manage shared local/SSH profiles with independent browser selection. A
  browser starts on the connection it last used while that connection still
  exists, otherwise on the service's default; phones still open on Town.
  Disconnect does not stop Herdr/workspaces. A Linux/macOS World service can reach Unix or Windows SSH hosts;
  a Windows World service supports local profiles. See [connection setup](../../../docs/DEPLOYMENT.md#local-and-ssh-connections).
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
  [runtime setup](../../../docs/DEPLOYMENT.md#herdr-installation-and-upgrades).
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
  [runtime limits](../herdr-core-runtime/notes.md#runtime-limits).
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
  or title discards the read. See the [harness inventory](../../../docs/core-harnesses.md).
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
  [above](../herdr-core-runtime/notes.md#runtime-limits). Scheduled tasks refuse a wiped or replaced core.
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
  push or this page only) or why they cannot (browser permission blocked). See [push setup and troubleshooting](../../../docs/DEPLOYMENT.md#web-push-notifications).
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
  `/healthz`. See [services](../../../docs/DEPLOYMENT.md#user-service).
- Keep Herdr on the version this World release verified: installer replacements and updates
  bring Herdr, the Codex/Claude/Pi harness integrations and the Herdr World plugin up to
  date, and **Settings → Herdr and connection details → Upgrade Herdr** (or **Update
  Herdr integrations**)
  appears when something is behind. A running server keeps its panes through a
  live handoff when World can prove nothing supervises it (Linux); otherwise World says a restart is
  needed. See
  [Herdr installation and upgrades](../../../docs/DEPLOYMENT.md#herdr-installation-and-upgrades).

**All listeners require login**, including loopback. World generates a persistent
token unless an 8–1024-character password is configured; 15+ characters are
recommended beyond a trusted private network. Failed logins receive a bounded cooldown. Configure [native HTTPS](../../../docs/DEPLOYMENT.md#native-https)
or an authenticated HTTPS proxy for encrypted access. World supplies no multi-user authorization or sandboxing; read [SECURITY.md](../../../SECURITY.md).

## SSH responsiveness

SSH runtimes share a private command connection while terminal transport stays
independent. Background reads leave command slots available for interactive work;
Git status refreshes in the background, and large untracked-file lists avoid a
command per file. Stalled sessions end through keepalives. See
[SSH setup and operator controls](../../../docs/DEPLOYMENT.md#ssh-command-sharing-and-port-forwards).
