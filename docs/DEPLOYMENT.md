# Installation and deployment

Herdr World is one Bun-compiled service and same-origin Web/PWA application. It
connects to one or more separately running Herdr servers through local sockets or
OpenSSH. Users do not install Roamgate or a remote World bridge.

Session cookies use a private random signing key under the World data directory.
It persists across restarts and rotates when the configured credentials change,
invalidating existing sessions. An instance-specific settings path isolates its
signing state. Management commands do not create or rotate signing keys.

Optionally set `HERDR_WORLD_PIN` to 6–12 ASCII digits for convenience login on a
trusted private network or VPN. Keep password/token recovery available. PIN login
has separate per-client throttling and a global cooldown after ten failures;
that cooldown does not block password/token login.

## Requirements

- A supported Linux, macOS, or Windows release, or Bun 1.4.1+ for a source build.
- Herdr 0.9.0 / terminal protocol 22 for the current endpoint path. The bridge also
  recognizes the older protocol range covered by its compatibility tests.
- OpenSSH on Linux or macOS for saved SSH profiles. Windows supports local profiles.

Herdr remains an external runtime. World never bundles or stops a Herdr server when a
profile is disconnected or removed.

## Herdr compatibility

The current setup target is Herdr 0.9.5, terminal protocol 22 and endpoint
generation 1. World also supports Herdr 0.9.0+ on protocol 22. Setup verifies
the pinned platform checksum before installation. Herdr 0.9.5 is a hotfix release;
its Codex status now comes from screen detection. Run `herdr integration install
codex` on that host to refresh an older integration when upgrading Herdr.
World also retains the verified legacy codecs for protocols 14-20. Protocol 21
and future protocols are rejected; use a World release explicitly supporting
the server rather than downgrading a running Herdr server.

In **Manage connections**, each host has its own running Herdr version and
protocol check. **Check version again** reads that exact connected host; the
result expires after one minute. Disconnected, unreadable or malformed results
stay **unknown**. A timeout does not mean Herdr is too old. An unavailable or
expired identity cannot establish compatibility, and a running server's version
does not identify the installed executable.

This connection view explicitly leaves upgrades **unavailable**: it has not
verified the installed binary, a strictly newer compatible update target or safe
handoff/supervision. It offers no remote update command and performs no update.
An exact socket or session scope alone does not establish update safety. Herdr
0.9.5's [native updater](https://github.com/herdrdev/herdr/blob/v0.9.5/src/update.rs)
has no pinned-target/dry-run command and stable/preview selection is not a
strictly-newer guarantee. Existing local installation controls
below retain their separate verified-target and supervision checks. Never use the
local updater as a fallback for a remote host or downgrade a newer running server.
See the [synthetic reference views](images/herdr-compatibility.md) at five sizes.

Herdr 0.9.0 provides **Local navigation** per browser and connection. Older
connections use **Shared navigation**. Pane topology, terminal sizes, and
same-tab pane focus remain shared even with Local navigation. Workspace/tab
creation needs a connected source terminal, except that an empty session can
create its first workspace.

OSC 52 clipboard writes on Herdr 0.9.0 follow the foreground recipient, which
cannot prove the originating pane. Browser clipboard permission and the active
terminal context still apply; do not treat clipboard delivery as pane isolation.

## Install a release

On Linux or macOS:

The published 0.2.7 standalone script installs or upgrades Herdr to its verified
release and refreshes harness integrations and the plugin. To leave your Herdr
untouched, add `HERDR_WORLD_SKIP_HERDR=1` before `sh` in the command below.
Homebrew already installs Herdr only when missing; the matching standalone fix
is merged in source for a future release.

```bash
curl -fsSL \
  https://github.com/IvoryHeart/herdr-world/releases/latest/download/install-herdr-world.sh \
  | HERDR_WORLD_VERSION= sh
~/.local/bin/herdr-world
```

Set `HERDR_WORLD_VERSION=X.Y.Z` to install a specific release, or
`HERDR_WORLD_INSTALL_DIR=/usr/local/bin` to choose another directory. Windows users
download the matching x64 or ARM64 archive and checksum from the release, extract it,
and run `herdr-world.exe`.

The process prints the application URL. The default is <http://127.0.0.1:8787>.
Open it directly or install it as a PWA. PWA mode removes browser chrome; it is not
offline mode and the World process must remain reachable.

For 0.2.0 and newer releases, install the same version through Homebrew on macOS
or Linux, or npm on any supported desktop platform:

```bash
brew install IvoryHeart/tap/herdr-world
npm install --global @ivoryheart/herdr-world
```

Choose one channel. Homebrew uses the published platform archive; npm installs a
small launcher and the matching platform binary. npm needs Node.js 22.14.0 or newer
and optional dependencies enabled. Homebrew installs only World into its keg,
without a mandatory `herdr` formula dependency. On first normal World launch, the
launcher reuses an existing Herdr; if missing, it installs the verified prebuilt
Herdr in its own default location. This applies to Apple Silicon, Intel and Linux.
No Intel source build is needed. Add `~/.local/bin` to `PATH` for direct `herdr` use.
npm leaves Herdr to you (see [Herdr installation and upgrades](#herdr-installation-and-upgrades)).
Neither starts Herdr. For an existing installation, stop the old World process
before upgrading the channel.

For a release candidate, request its exact version. The standalone installer
accepts `HERDR_WORLD_VERSION=X.Y.Z-rc.N`, npm accepts
`@ivoryheart/herdr-world@X.Y.Z-rc.N`, and Homebrew uses
`IvoryHeart/tap/herdr-world-rc` after the reviewed RC Formula PR merges.
Homebrew's RC and stable Formulae conflict, so uninstall the stable Formula before
installing the RC. Candidates do not replace the stable GitHub Latest release or
npm `latest` tag.

This foundation starts with fresh World state. It uses
`~/.config/herdr-world` (or `%APPDATA%\herdr-world`) and browser keys under
`herdr-world:foundation-v2:`. It does not read old Herdr World bridge profiles,
Roamgate settings, or their browser preferences. Those files remain untouched for
rollback. These World paths are stable across 0.2.x versions: an upgrade does not
create a new config directory. The plugin uses a temporary directory only while
unpacking a release archive, then removes it. Browser storage is tied to the World
origin, so opening the same service through a different hostname or port shows that
browser's separate state. Saved connection profiles and service settings remain in
the service user's config directory.

### Replacing Herdr World 0.1.1 or earlier

Stop the old World process before upgrading so it does not retain port 8787. Do not
stop the Herdr runtime or an unrelated Roamgate or Herdr Web process. If another
product owns 8787, choose a different World port as described below. If
continuing with npm or Homebrew, upgrade the existing channel:

```bash
# Choose only the package-manager command that applies.
npm install --global @ivoryheart/herdr-world@latest
brew upgrade herdr-world
```

If switching from one of those channels to the standalone installer, remove its
old launcher first:

```bash
npm uninstall --global @ivoryheart/herdr-world
brew uninstall herdr-world
```

The old Herdr plugin is different: its actions are asynchronous and target-scoped. For
the default target, invoke `stop`, use its returned `log_id` to wait until the action
log reports `status: succeeded`, then invoke `status` and wait for that action to report
success with output saying the bridge is not running:

```bash
herdr plugin action invoke stop --plugin ivoryheart.herdr-world
herdr plugin log list --plugin ivoryheart.herdr-world --limit 100
herdr plugin action invoke status --plugin ivoryheart.herdr-world
herdr plugin log list --plugin ivoryheart.herdr-world --limit 100
```

Repeat the same stop/log/status/log sequence for every named Herdr target that ran the
old plugin, replacing `NAME` each time:

```bash
herdr --session NAME plugin action invoke stop --plugin ivoryheart.herdr-world
herdr --session NAME plugin log list --plugin ivoryheart.herdr-world --limit 100
herdr --session NAME plugin action invoke status --plugin ivoryheart.herdr-world
herdr --session NAME plugin log list --plugin ivoryheart.herdr-world --limit 100
```

Only after every target is confirmed stopped, install the new plugin at the exact
release tag. Herdr replaces the installed plugin in place; uninstalling 0.1.1 first
is unnecessary:

```bash
herdr plugin install IvoryHeart/herdr-world --ref vX.Y.Z
```

The former desktop-tarball installer exposed `~/.local/bin/herdr-world` as a symlink
into `~/.local/share/herdr-world/vX.Y.Z/`. The new release installer recognizes and
replaces that default launcher safely while leaving the old versioned bundle available
for rollback. A custom or unrelated symlink is rejected; move it aside explicitly and
rerun the installer. The obsolete `herdr-world-installer` command and old versioned
bundle can be removed manually after the new application and profiles are verified.

Start the new release and recreate local or SSH profiles in Spaces. Old profile
files and browser preferences are deliberately neither read nor deleted. Check the
new service and profiles before removing an old versioned bundle; reinstalling the
old channel or relinking an old bundle is the rollback path. A new 0.2.x version
continues to use the same World profiles, settings, token, and browser namespace.

## Herdr installation and upgrades

**Published 0.2.7:** the downloaded standalone installer runs
`herdr-world herdr upgrade --install`, including upgrades of an older unmanaged
Herdr and integration/plugin refresh. Set `HERDR_WORLD_SKIP_HERDR=1` to skip that
step. Homebrew already uses missing-only setup. The source installer behavior
described below is merged but has not shipped in a standalone release yet.

Each Herdr World release verifies one Herdr release (currently 0.9.5) and pins its
SHA-256 checksums. Missing-only bootstrap installs the runtime without configuring
harness integrations or the plugin. Run `herdr-world herdr upgrade` to refresh
those integrations explicitly; it also upgrades an older unmanaged Herdr to the
verified release:

```bash
herdr-world herdr status
herdr-world herdr setup             # install if missing, then start a user service
herdr-world herdr upgrade           # Herdr, harness integrations and plugin
herdr-world herdr upgrade --install # also install Herdr when none is found
```

World looks for Herdr in `HERDR_BIN_PATH`, then `PATH`, then Herdr's default
location: `~/.local/bin/herdr` on Linux and macOS, or
`%LOCALAPPDATA%\Programs\Herdr\bin\herdr.exe` on Windows (`HERDR_INSTALL_DIR`
overrides both, as it does for Herdr's own installers). A Herdr that World installs
lands there, so `herdr` and `herdr update` find it afterwards.

When it runs:

- **Standalone installer in source** (`install-herdr-world.sh`): after installing World it runs
  a read-only Herdr status check, then uses the Unix `--install --only-if-missing`
  operation when the selected World binary supports it. Pinned older releases
  use the same checksum/version-verified compatibility bootstrap as Homebrew,
  without passing unsupported options or calling an unrestricted upgrade.
  A reachable Herdr server is reused even when its executable is not discoverable.
  A selected local entry must be a regular executable file before installation
  reports success. A runtime appearing during download is preserved by atomic publication.
  Existing versions and installation owners are preserved. Set
  `HERDR_WORLD_SKIP_HERDR=1` to install only World. A Herdr problem prints a warning
  and leaves World installed. Fresh installs leave harness integrations and the
  plugin to `herdr-world herdr upgrade` (or **Runtime → Update Herdr integrations**).
- **`herdr-world update` and the in-app update**: once the new World is in place, the
  new release runs the Herdr step, even when it keeps the same Herdr version, because
  the harness integrations and the plugin follow the World release. In the browser it
  is its own notice after the reload. That notice appears only when something
  changed, and it reports a failed step as incomplete.
- **Menu**: **Runtime → Upgrade Herdr** appears when Herdr or its running server is
  older than the verified release. **Runtime → Update Herdr integrations** appears
  when only harness integrations or the plugin are behind.
- **Homebrew**: the launcher checks for Herdr before normal local World startup,
  using the same `HERDR_BIN_PATH`, `PATH` and default-location lookup. It reuses any
  existing installation, including standalone, version-managed and Homebrew-owned
  runtimes. If missing, it installs the verified prebuilt release outside the World
  keg, without starting a Herdr service or refreshing integrations. Downloads must
  match the pinned checksum and version; atomic publication never replaces a runtime
  appearing during setup. Existing
  versions are never automatically upgraded by this bootstrap. Metadata and
  management commands do not bootstrap; remote/custom endpoints also skip it.
  A failed check or download prints a warning and World still starts, so SSH
  profiles and in-app setup remain available; retry with
  `herdr-world herdr upgrade --install`.
  A broken symlink or another non-executable entry at Herdr's default path is left
  intact and reported before downloading; repair that entry before retrying.
  Set `HERDR_WORLD_SKIP_HERDR=1` to skip the automatic check. An incompatible existing
  runtime needs an explicit upgrade through its owner (`brew upgrade herdr` for a
  Homebrew runtime, `herdr update` for Herdr's own installation).
- **npm and Windows archives**: run `herdr-world herdr upgrade --install` once
  yourself, or use the menu.

What the upgrade does:

1. **Binary.** It downloads the verified release and checks its checksum and
   `herdr --version` before replacing anything. On Linux and macOS the old binary
   stays beside the new one as `herdr.previous`, and a failed check restores it.
   On Windows, World runs Herdr's own `install.ps1` (checksum-pinned) with the
   verified package; that installer keeps earlier releases and switches only after
   its own checks. World upgrades a Windows Herdr only in the layout that installer
   manages: its visible bin, its `current` junction or a release directory under
   `%USERPROFILE%\.herdr` (`HERDR_HOME`), which PATH may point at directly. A Herdr
   that Herdr World 0.2.6 or earlier installed under
   `%APPDATA%\herdr-world\herdr\<version>` (found even though it is not on PATH)
   moves to Herdr's default location, and the old copy stays as a backup. Whenever
   an upgrade moves Herdr (from that legacy copy, or from a release directory on
   PATH to the default bin), World's Herdr scheduled task is re-registered at the
   new path without being restarted. A Herdr elsewhere is reported and left alone. World never downgrades
   a newer Herdr. It also leaves Homebrew, mise, asdf and Nix installs, and any
   shim, to their manager; it prints the command to use.
2. **Running server.** A Herdr server keeps running its old version until it is
   replaced. On Linux and macOS, World asks the server to hand its panes to the new
   version live, as `herdr update --handoff` does, but only when the server supports
   it and World can prove that nothing supervises it. Herdr starts the new server as
   a child of the old one, so a service manager or wrapper would end the panes or
   start a competing server when the old one exits. The proven case is Linux: the
   server owning the control socket is a daemonized Herdr (its parent is init or
   the user's systemd manager) in a terminal or login scope. Everywhere else the old
   server keeps your panes and World says that a restart is needed: macOS (no
   unprivileged check can rule out a launchd job or wrapper), Windows, any systemd
   service, a wrapper parent, an unidentifiable owner, an older server or a failed
   handoff. World never stops or restarts Herdr itself, and never hands
   a newer or unidentified server to an older release. A handoff that leaves no
   server running is reported as a failure.
3. **Harness integrations.** World supports the Codex, Claude and Pi harnesses. For
   each one installed on this machine (its `codex`, `claude` or `pi` command is on
   `PATH`), World runs `herdr integration install codex|claude|pi`. It does so
   without prompting when the integration is missing or outdated, and for every
   present harness after a Herdr upgrade: a new Herdr can change what an
   integration installs, as 0.9.5 did when it dropped Codex turn hooks. Harnesses
   that are not installed are skipped.
4. **Plugin.** If the `ivoryheart.herdr-world` plugin was installed from GitHub,
   World pins it to this World's release or release-candidate tag with
   `herdr plugin install IvoryHeart/herdr-world --ref vX.Y.Z --yes`. A linked plugin,
   a pre-merge preview or a source build is left alone.

To roll back a Linux or macOS Herdr binary, move `herdr.previous` back over `herdr`;
the running server is unaffected.

Managed setup and upgrades act on this machine's Herdr. Setup is limited to the
default local configuration: named sessions, explicit sockets and SSH targets must
be started by their operator.

**SSH hosts (design, not yet available).** The plan is a per-connection **Upgrade
Herdr on this host** action that the owner confirms each time. Over the
connection's OpenSSH command it would read the remote `herdr --version`. Only when
Herdr's published manifest offers exactly the version and checksum this World
verified would it run the remote `herdr update --handoff`; Herdr's updater verifies
the download and refuses package-managed installs. It would then run the same
harness-integration step remotely and report the outcome. It would never install
Herdr on a host that lacks it.

## Local and SSH connections

Open Manage connections to add, test, connect, disconnect, edit, or remove
profiles. Profiles are shared by authenticated browsers. Town, Board, Desk,
counts, and search aggregate the observed hosts; Hosts filters that overview.
Each terminal and Inspector retains its own connection and runtime generation.
Changing the filter or focusing another host leaves unrelated contexts open and
does not redirect their operations.

Local profiles name existing Herdr control and render sockets. SSH profiles accept
only an OpenSSH alias or `user@host`. Leave remote socket fields empty to use the
default sockets below the remote user's home directory:

```text
Destination: workbox
Control socket: (empty - auto)
Render socket:  (empty - auto)
```

Put ports, jump hosts, keys, and other SSH policy in the service user's
`~/.ssh/config`. World passes a fixed noninteractive OpenSSH command, keeps host-key
checking enabled, and never stores passwords, passphrases, private keys, or arbitrary
SSH arguments. Confirm the host key and authentication from a terminal before using a
managed service, because the service cannot answer prompts.

Each connected profile owns an isolated runtime, transport, subscription set, cache,
and generation. A failed profile cannot redirect a request to another profile. World
may continue showing its last topology as stale, but stale entities cannot open a
terminal or Inspector resource. Disconnecting a profile stops only World-owned
transport; Herdr workspaces and agents continue running.

Profiles are stored atomically in `~/.config/herdr-world/connections.json` on Unix or
`%APPDATA%\herdr-world\connections.json` on Windows. Override that path with
`HERDR_WORLD_CONNECTIONS_PATH`. The containing directory and file use owner-only
permissions on Unix, and symlinked registry paths are rejected.

The command-line default remains useful for a single connection:

```bash
herdr-world --socket-path /path/to/herdr.sock \
  --client-socket-path /path/to/herdr-client.sock
herdr-world --ssh-host workbox
```

## Agent profiles and the launcher

**New agent** starts a harness in a new Herdr tab through the connection that
owns the chosen room (`tab.create`, then `agent.start` with the profile's
arguments, then a readiness wait and the first prompt). Agent kinds come from
the host's Herdr (`server.agent_manifests`); an older Herdr offers Claude and
Codex. Profiles are stored atomically, with owner-only permissions, in
`~/.config/herdr-world/agent-profiles.json` on Unix or
`%APPDATA%\herdr-world\agent-profiles.json` on Windows; override the path
with `HERDR_WORLD_AGENT_PROFILES_PATH`. Profiles refuse text that looks like a
credential and never hold one. The same file keeps your chime settings and who
the Town master is; a device's own chime switch and volume stay in that
browser. Herdr reports `herdr notification show` without a pane, so World
can't say which agent sent it.

To show whether a harness is installed and logged in, the service runs each
harness's own status command on the room's host (locally, or over the
connection's OpenSSH destination): `claude auth status` and
`codex login status`. It keeps only whether the harness is logged in and the
login method; the commands' other output, which can name the account, is
discarded. It also lists `SKILL.md` folders by name. A service whose `PATH`
lacks the harness still finds it in the usual install folders (such as
`~/.local/bin`). **Log in** opens a new tab and shows the harness's fixed login
command (`claude auth login`, `codex login --device-auth`), wrapped in `sh -c`
so it finds the executable the same way, with **Copy** and **Open its tab**.
You run it there and finish the login yourself. World types nothing into the
tab: Herdr can't tell a prompt from a startup script waiting for a key. Windows
hosts are not probed: their harnesses show no status, and every agent kind
their Herdr supports stays available. Log in is not offered there.

## Optional cost metrics

The Town board can show token use and reported cost from a Prometheus-compatible
HTTP API. It does not supply Board notes, strings or agent status. Open
**OTEL economy metrics** from the settings menu and save an HTTP or HTTPS base URL,
or set the service startup default:

```bash
HERDR_WORLD_OTEL_PROMETHEUS_URL=http://127.0.0.1:9090 herdr-world
```

The saved setting takes precedence over the environment, including an explicit
Disable choice, and is stored in World's owner-only `settings.json`. URLs with embedded
credentials, queries or fragments are rejected. Put authentication and network policy
outside this credential-free integration if the provider is not local.

The browser never contacts Prometheus. The World service polls fixed, bounded 24-hour
queries every 30 seconds for Codex token counters and Claude token/reported-cost
counters, caps response size and model rows, and does not estimate missing prices.
Provider failure appears as degraded or unavailable Economy data; connections,
topology, terminal conversations and Inspector operations continue normally.

## Built-in sources: GitHub and Jira

World shows your pull requests and tickets on Board's Work lens and as desk
badges in Town. Both sources ship with World and are on by default; switch
either off in **Settings → Sources**. Each is read only while a visible browser
tab shows it, at most once a minute, and a failed refresh keeps the last items.
Requests answer within two seconds with what World has while a slow `gh`,
Jira or SSH lookup finishes in the background.

- **GitHub** runs `gh` as the service user. Install the
  [GitHub CLI](https://cli.github.com/) for that user and run `gh auth login`
  (for a user service, the same account the service runs as). Until then the
  source says **Sign in with gh auth login**. World stores no GitHub token.
  Merged pull requests cover the last 7 days by default (1 to 90 in
  **Settings → Sources**, saved as `custom.world_sources.github.mergedDays`);
  World follows cursor pages of 100 results through GitHub search's 1,000-result
  limit. The configured window filters this history; there is no smaller
  client-side count cap.
- **Your open pull requests** are read in more detail: checks on the head,
  changed files, and the last 30 reviews and 50 comments, which stay in the
  service (the browser gets only reviewer results and an image count). World
  reads at most 20 a refresh, 10 per request, and reads one again only when
  GitHub reports it changed, while its checks run, or after 10 minutes.
- **Merge, close and mark ready** run `gh pr merge --merge
  --match-head-commit <head>`, `gh pr close [--comment]` and `gh pr ready`
  as the service user, after a confirm in the browser. Merge reads the pull
  request again first and refuses if the head moved or a review is still
  required; World never passes `--admin`. The gh sign-in needs permission to
  merge in that repository. World records each verb run, its outcome and
  that the browser asked, in memory until the service restarts.
- **Jira Cloud** needs your site (`example.atlassian.net`), account email and an
  [API token](https://id.atlassian.com/manage-profile/security/api-tokens),
  entered in **Settings → Sources**. The site and email are saved in
  `settings.json` (`custom.world_sources`); the token is saved in an owner-only
  `source-secrets.json` (or `source-secrets-<hash>.json` beside a custom
  `HERDR_WORLD_SETTINGS_PATH`) in World's data directory and is never sent to the
  browser. Changing the site or email removes the saved token. The filter defaults to `(assignee = currentUser() OR watcher =
  currentUser()) AND (statusCategory != Done OR updated >= -7d) ORDER BY updated DESC`;
  up to 100 tickets are read.

To link a pull request to an agent, World reads the branch and GitHub remotes
of the agent's checkout: its reported checkout (`herdr-world agent-checkout`),
else its pane's directory, else its workspace's worktree. It runs `git` locally
for local profiles and over the profile's SSH destination for SSH profiles;
Windows hosts are not read. At most 32 checkouts are read per refresh and each
is cached for two minutes. A pull request an agent reports with `--pr` links
directly. Without `git` on that host, or for a directory that is not a
repository, pull requests and tickets still show; only that agent's desk link
is missing, and World reports no error for it. If GitHub or Jira is down,
that source shows an error and keeps its last items.

## Herdr plugin

The plugin ID is `ivoryheart.herdr-world`. For an unreleased checkout, build the
binary before linking the directory:

```bash
git clone https://github.com/IvoryHeart/herdr-world.git
cd herdr-world
bun scripts/world-plugin.ts build-source
herdr plugin link .
```

For a published release:

```bash
herdr plugin install IvoryHeart/herdr-world --ref vX.Y.Z
```

Released plugins use the system shell on Unix or Windows PowerShell on Windows
and download the manifest's exact World release, verifying its checksum, package
metadata, executable version and native plugin support before replacement. Neither
installation nor actions require Bun. Unix needs curl, tar with xz support and a
SHA-256 tool; Windows needs PowerShell and tar.exe. Older releases without native
plugin support fail with the source-build instructions above; source builds and
local linking still require Bun.

The plugin manages the same World user service as the CLI and never stops the
external Herdr runtime. Its native compatibility launcher preserves the cached
`server/herdr-world-plugin.exe <verb>` action argv, including the panel. It delegates
service work to the canonical sibling World executable, preserving plugin update
ownership. Restart refreshes generated service paths and refuses custom definitions;
start explicitly forces installation. Configured ports and credentials are preserved.
Update plugins through Herdr rather than standalone update/rollback commands.
Reinstall only when upgrading from older actions that still invoke Bun.

```bash
herdr plugin action invoke ivoryheart.herdr-world.start
herdr plugin action invoke ivoryheart.herdr-world.url
herdr plugin action invoke ivoryheart.herdr-world.status
herdr plugin action invoke ivoryheart.herdr-world.restart
herdr plugin action invoke ivoryheart.herdr-world.uninstall

herdr plugin pane open --plugin ivoryheart.herdr-world --entrypoint panel
```

The panel reports status, URL, and version and exposes start/restart/uninstall actions.

## Listener and authentication

Flags override environment variables, which override defaults. `herdr-world --help`
is authoritative.

| Flag | Environment | Default |
| --- | --- | --- |
| `--host <addr>` | `HOST` | `127.0.0.1` |
| `--port <n>` | `PORT` | `8787` |
| `--password <pw>` | `HERDR_WORLD_PASSWORD` | Generated persistent login token |
| `--socket-path <path>` | `HERDR_SOCKET_PATH` | Default Herdr control socket |
| `--client-socket-path <path>` | `HERDR_CLIENT_SOCKET_PATH` | Default Herdr render socket |
| `--ssh-host <alias>` | `HERDR_SSH_HOST` | Disabled |
| `--session <name>` | `HERDR_SESSION` | Default session |
| `--public-dir <path>` | `PUBLIC_DIR` | Embedded frontend |
| `--public-origin <origin>` | `HERDR_WORLD_PUBLIC_ORIGIN` | Disabled |
| `--tls-cert <path>` | `HERDR_WORLD_TLS_CERT` | Disabled; requires matching TLS key |
| `--tls-key <path>` | `HERDR_WORLD_TLS_KEY` | Disabled; requires certificate chain |
| `--notification-source <source>` | `HERDR_WORLD_NOTIFICATION_SOURCE` | `herdr`; `status` uses World agent-status alerts |
| `--log-level <level>` | `HERDR_WORLD_LOG_LEVEL` | `info` |
| `--open` | `OPEN_BROWSER=1` | Disabled |

### Port conflicts

World, Roamgate, and older Herdr Web processes may all try port 8787. Only one can
listen on the same address and port. World reports an occupied listener and leaves
the other process alone; it does not silently switch ports. On macOS, inspect the
owner with `lsof -nP -iTCP:8787 -sTCP:LISTEN`; on Linux use
`ss -ltnp '( sport = :8787 )'`. Stop an old World process before replacing it, or
give World a free port, for example `herdr-world --port 8788`.
On macOS, `herdr-world service install` checks its configured listener before
registering the launchd job and reports a port conflict without claiming the
service started. It leaves the preserved service config available for a port change.

For a managed World service, set `PORT=8788` in the preserved
`~/.config/herdr-world/herdr-world.env` (or `%APPDATA%\herdr-world\herdr-world.env`)
and run `herdr-world service restart`. Use that same port in the URL, reverse proxy,
and health check. The service environment file is read by the managed service;
`--port` or a shell `PORT` variable controls a foreground process. An existing
service keeps its configured port when a new version is installed.

Every listener requires login, including localhost. World creates a persistent
login token unless `HERDR_WORLD_PASSWORD` is set to a password containing
8–1024 characters; 15 or more are recommended beyond a trusted private network.
Startup warns for shorter configured passwords. On generated-token logins,
**Where do I find my token?** shows a home-relative command to run on the World
host. It never exposes the token or account name. For a managed user service,
`herdr-world url --qr` prints its login QR; foreground instances use their own
printed URL and token. A symlinked user configuration root (for example `.config`)
is supported, while links inside World's own state directory remain rejected.
 Repeated failed login attempts receive a cooldown. A token URL establishes
an HttpOnly session and removes the token from the address bar. Privileged browser HTTP
and WebSocket admission automatically requires the browser Origin authority to equal
the request Host authority; loopback listeners also reject non-loopback Host
authorities. There is no user-managed Host or Origin allow-list. To place an
independently authenticated HTTPS reverse proxy in front of a loopback listener, set
its one exact external origin and preserve the public Host header:

```bash
HERDR_WORLD_PUBLIC_ORIGIN=https://world.example herdr-world
```

The proxy must forward `Host: world.example`; World accepts only that configured origin
in addition to its loopback authority. The listener, proxy authentication, firewall/VPN,
and TLS remain the broader access boundary. Read [SECURITY.md](../SECURITY.md) before
exposing the listener beyond loopback.

World is a trusted single-user administration tool. It does not provide rate
limiting, multi-user roles, or a sandbox.

## Native HTTPS

Supply a PEM certificate chain (leaf first) and a matching unencrypted private
key, through flags or the environment settings above:

```bash
herdr-world --host 0.0.0.0 --port 8443 \
  --tls-cert /path/to/cert-chain.pem --tls-key /path/to/private-key.pem
```

Missing, unreadable, malformed, or mismatched TLS files stop startup. World
uses HTTP when neither TLS setting is supplied. HTTPS adds Secure cookies and
HTTPS startup links; authentication still follows the listener policy.
Every listener requires the configured password or generated token. Keep access private as described in [Security](../SECURITY.md).

Use certificates whose Subject Alternative Names match every client hostname or
IP address. Each device must trust the issuer; bypassing a certificate warning
does not make service workers or notification APIs available. For a private
LAN test, a local issuer such as [mkcert](https://github.com/FiloSottile/mkcert)
can issue a certificate for `localhost`, loopback addresses, and the host's LAN
address. Transfer only the issuer's public CA certificate to client devices,
never its private key. iOS also requires enabling full trust for an installed
CA profile in Certificate Trust Settings. Remove temporary trust after testing.

Protect certificate keys, keep them out of Git, and use absolute paths readable
by the service user. Issuance and renewal are external; restart World after
replacing the files. An HTTPS reverse proxy is another option; preserve its
public Host and configure `--public-origin` when proxying to loopback.

## Web Push notifications

1. Open World over trusted HTTPS. On iOS/iPadOS 16.4 or newer, open the installed
   Home Screen PWA.
2. Open **Menu → Behavior & automation → Task notifications**, enable alerts,
   grant browser permission, and choose **Agent needs input** and/or
   **Task completed**.
3. Confirm **Background push** enrollment. If an existing browser only has local
   alerts, toggle notifications off and on to enroll it again.

Server delivery is enabled by default; each browser profile needs its own
subscription. `HERDR_WORLD_WEB_PUSH_SUBJECT` optionally supplies a `mailto:` or
HTTPS operator contact, not a delivery destination. The default is the World
repository's issues URL. An explicitly empty value disables server push;
unsetting it restores the default. Restart World after changing its environment.

Private VAPID keys and subscriptions live in
`~/.config/herdr-world/web-push.json` on Unix or
`%APPDATA%\herdr-world\web-push.json` on Windows. Override the file with
`HERDR_WORLD_WEB_PUSH_PATH`. Protect and back up this file, never share or commit
it, and use one World process per file. Corrupt data is preserved and push is
disabled rather than silently rotating keys. After intentional key replacement,
reopen World and re-enroll each browser.

Delivery requires outbound HTTPS to the browser's provider: Apple
(`*.push.apple.com`), Google (`fcm.googleapis.com`), Mozilla
(`*.push.services.mozilla.com`), or Windows (`*.notify.windows.com`). World
rejects other provider destinations. No public inbound endpoint is needed.
World and the relevant Herdr connection must remain running; the device must
reach World when opening an alert. Logging out revokes that authenticated
session's subscriptions. An alert with a pane target revalidates its connection
and runtime generation; it never falls back to a different host.

If alerts fail, check HTTPS trust, browser permission, Background push enrollment,
provider connectivity, and the alert's owning Herdr connection. Local browser alerts
and background push are different delivery paths; an open-page alert alone does
not prove background enrollment.

## Logging

Logs contain one line per event with a timestamp, severity, scope, and bounded
context. The default `info` level covers lifecycle and failures. For a short
investigation, run `herdr-world --log-level debug` or set
`HERDR_WORLD_LOG_LEVEL=debug` in the service environment and restart it. Restore
`info` afterwards. Debug output can contain paths and identifiers; review and
redact diagnostic logs before sharing them. Authentication tokens are kept in
protected files rather than logged startup URLs.

## User service

```bash
herdr-world service install
herdr-world service status
herdr-world service restart
herdr-world service reload
herdr-world service uninstall
```

`service install` listens on `0.0.0.0:8787` by default and generates a login
token. Edit `~/.config/herdr-world/herdr-world.env` (or the matching `%APPDATA%`
file), then restart to use a different port. The service identities are:

- Linux: `~/.config/systemd/user/herdr-world.service`
- macOS: `~/Library/LaunchAgents/dev.herdr-world.plist`
- Windows: a per-user `dev.herdr-world-<key>` scheduled task

Verify readiness with `curl -fsS http://127.0.0.1:8787/healthz`, substituting the
configured port. Uninstall preserves configuration and tokens. The updater installs
a checksum-verified replacement and leaves `herdr-world.previous` for recovery.
The in-app checker follows newer release candidates on the same version line and
then the stable release; stable builds follow GitHub Latest. Automatic installation
is available only for supervised standalone binaries. Homebrew, npm, and Herdr
plugin installations must be upgraded through their installation channel.
Pre-merge previews have no update channel.

## Private remote access

The simplest multi-host arrangement keeps World on the user's computer and adds remote
Herdr servers as SSH profiles. The browser still connects only to the local World
origin. To open the World UI from another trusted device, put an authenticated VPN,
HTTPS reverse proxy, or SSH port forward in front of the World listener. Do not expose
World directly to the public internet.

See the [tutorial](./TUTORIAL.md#networking) for
Tailscale and SSH examples.

## Source development and builds

```bash
bun install --frozen-lockfile

# Separate terminals
bun run dev:server
bun run dev:web

# Complete local candidate
bun run check
```

The Vite URL is <http://localhost:5173>; it proxies the service on port 8787.
`bun run build` embeds the production frontend and Bun runtime in
`server/herdr-world`. Cross-platform build and package commands are listed in
[packaging](./packaging.md).

## Troubleshooting

### The default profile cannot connect

Confirm Herdr is running and inspect its sockets:

```bash
herdr-world herdr status
ls ~/.config/herdr/herdr.sock ~/.config/herdr/herdr-client.sock
```

Use explicit socket paths if the server has a non-default configuration.

### An SSH profile fails

Run `ssh workbox true` as the same user that runs World. Resolve any host-key prompt,
agent/key problem, jump-host rule, or remote socket absence there. World reports
bounded diagnostics and deliberately does not retry authentication and host-key
failures. Classified transient tunnel exits and timeouts, including exit 255
during initial remote HOME discovery, use the existing
per-profile exponential backoff with jitter. By default recovery continues while
the connection is enabled; each delay is capped at 30 seconds (15–30 seconds
once capped), rather than stopping permanently after six failures. Disconnect,
removal, replacement and service shutdown cancel or retire pending recovery.
Unclassified, authentication, permission, host-key and unsupported failures do
not acquire an endless retry policy. An explicitly supplied finite retry budget
remains finite.

Cached topology stays stale and non-actionable. Town's building and reception,
and Board's host label, show **Disconnected · Reconnect** for a failed runtime.
Use **Reconnect** to reset that profile's existing recovery flow; healthy sibling
hosts keep their own runtimes. A completed connection alone does not promote old
cached topology: a current-generation snapshot is needed. See
[connection recovery](world-connection-recovery.md).

A non-interactive SSH shell can omit `herdr` from PATH even when it is installed.
POSIX World forwarding resolves the remote home and connects to the saved/inferred
Herdr sockets; it does not require a bare `herdr` command. For separate CLI
version/status diagnostics, resolve the actual native executable or its standard
installation path. PATH lookup failure is not proof of absence or version skew.
This recovery fix changes no remote installation or server.

### Another device cannot open World

Check the printed URL, authentication, listener address, firewall, and outer VPN/proxy
in that order. Binding `127.0.0.1` is intentionally local. Binding `0.0.0.0` requires
the generated token or configured password. For encryption, configure
[native HTTPS](#native-https) or an authenticated HTTPS proxy.

### The port is occupied

Only one process can listen on 8787. Stop the old World/Roamgate process or choose
another port with `--port`; do not run two shells for one installation.

## Ranger workspace assistant

Open **Ranger** in the desktop toolbar or mobile controls. Connect a model provider
using Ranger credentials, explicit Pi credentials, or a custom model endpoint.
Use the gear button in the Ranger panel for model credentials and workspace
permissions. **Menu → Configuration → Integrations** manages agent integration
scripts on the selected Herdr host; it is separate from Ranger model setup.
Allow specific workspaces in Ranger settings before asking it to read status,
terminal output, agent history or Git changes. New installations allow no
workspaces. Manual approval is the default for proposed workspace actions; high
permission is an explicit setting.

Tasks run in separate service-owned conversations, either once, at an interval,
or daily. Monitoring tasks can notify only when Ranger detects a meaningful
change. Review and confirm proposed schedules before enabling them. Saved tasks
retain endpoint, Herdr server and workspace identity; a changed identity prevents
recovery. Interactive requests capture the current connection generation and
cannot continue against a replacement runtime.

Ranger state and credentials live in the World data directory's `assistant`
subdirectory. `HERDR_WORLD_ASSISTANT_DIR` overrides that location. Keep this data
private. Models receive the selected workspace context; choose providers and
workspace permissions accordingly. Closing the panel does not stop tasks; use
its task controls to stop or disable them.

Saved grants for temporarily unavailable workspaces remain visible under
**Unavailable authorized workspaces**. Remove one permission without clearing
other grants, then save settings. A complete authoritative listing still removes
grants for deleted workspaces. High mode must be turned off before restricting
its all-workspace access with individual manual grants.

On Windows SSH workspaces, Ranger supports native status and terminal reads.
Agent history and Git diff reads return an unsupported-operation error before
running Unix-only resource helpers.

## Windows hosts over SSH

From a Linux or macOS World service, select **Windows** as the remote host OS
when adding an SSH profile. The Windows host needs OpenSSH, Windows PowerShell
and a running Herdr 0.9.1+ session. Leave the executable and session fields empty
for discovery, or supply an absolute Windows `.exe` path and a validated session
name. SSH authentication and host trust still belong in the service user's
OpenSSH configuration. Windows profiles do not use Unix remote socket paths.

World forwards native Herdr control and terminal streams through service-owned
SSH processes. Terminal and native workspace actions are supported; file, Git,
worktree and agent-history tools requiring Unix commands remain unavailable.
Changing the Windows executable or session changes recovery identity, so saved
Ranger tasks cannot silently resume against a replacement target.

## Ranger settings and management

Ranger settings group credential source, providers, custom models and workspace
permissions. The custom-model editor shows model IDs and supported thinking
levels separately from endpoint credentials; a blank API key preserves its saved
value. Chat history is a separate navigable panel. On compact screens the
conversation minimap appears below messages.

Ranger can propose editing, pausing, resuming, cancelling and deleting existing
tasks. Management previews retain the task revision and scope, follow the current
manual/High approval policy, and expire after ten minutes or service restart.
Task edits preserve saved model, scope and agent references; a confirmed manual
edit downgrades future execution to manual approval. Delete requires prior
cancellation. Close-agent, close-pane and close-workspace previews recheck captured
occupants before dispatch and do not delete checkout files or agent history.
