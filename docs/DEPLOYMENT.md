# Installation and deployment

Herdr World is one Bun-compiled service and same-origin Web/PWA application. It
connects to one or more separately running Herdr servers through local sockets or
OpenSSH. Users do not install Roamgate or a remote World bridge.

## Requirements

- A supported Linux, macOS, or Windows release, or Bun 1.4.1+ for a source build.
- Herdr 0.9.0 / terminal protocol 22 for the current endpoint path. The bridge also
  recognizes the older protocol range covered by its compatibility tests.
- OpenSSH on Linux or macOS for saved SSH profiles. Windows supports local profiles.

Herdr remains an external runtime. World never bundles or stops a Herdr server when a
profile is disconnected or removed.

## Install a release

On Linux or macOS:

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

This foundation starts with fresh World state. It uses
`~/.config/herdr-world` (or `%APPDATA%\herdr-world`) and browser keys under
`herdr-world:foundation-v2:`. It does not read old Herdr World bridge profiles,
Roamgate settings, or their browser preferences. Those files remain untouched for
rollback.

### Replacing Herdr World 0.1.1 or earlier

Stop the old World service before installing this foundation so it does not retain
port 8787. Use the removal path for the channel you previously installed:

```bash
# For a foreground or operator-managed standalone installation, stop that process
# first. Herdr World 0.1.1 did not provide a `service` subcommand. Then choose only
# the package-manager command that applies.
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

Only after every target is confirmed stopped should the old controller be removed and
the replacement installed:

```bash
herdr plugin uninstall ivoryheart.herdr-world
herdr plugin install IvoryHeart/herdr-world --ref vX.Y.Z
```

The former desktop-tarball installer exposed `~/.local/bin/herdr-world` as a symlink
into `~/.local/share/herdr-world/vX.Y.Z/`. The new release installer recognizes and
replaces that default launcher safely while leaving the old versioned bundle available
for rollback. A custom or unrelated symlink is rejected; move it aside explicitly and
rerun the installer. The obsolete `herdr-world-installer` command and old versioned
bundle can be removed manually after the new application and profiles are verified.

Install the new release using the command above, start it, and recreate local or SSH
profiles in Spaces. Old profile files and browser preferences are deliberately neither
read nor deleted.

## Managed Herdr setup

For the default local profile, World can install or start the pinned Herdr runtime:

```bash
herdr-world herdr status
herdr-world herdr setup
```

The same action appears in the UI when the default local sockets are unavailable.
Managed setup is intentionally limited to the default local configuration; named
sessions, explicit sockets, and SSH targets must be started by their operator.

## Local and SSH connections

Open the connection selector in Spaces to add, test, connect, disconnect, edit, or
remove profiles. Profiles are shared by authenticated browsers; each browser chooses
its own focused connection for terminal and Inspector work. Office, Tree, Graph,
their counts, and search show only that selected connection. Changing the connection
replaces the complete visual presentation; other configured connections remain
observed in the background until selected.

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

## Optional Office metrics

Office can populate its Economy board from a Prometheus-compatible HTTP API. Open
**Office metrics** from the Office toolbar and save an HTTP or HTTPS base URL, or set
the service startup default:

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

The plugin downloads or uses the matching World binary and manages the same user
service as the CLI. It does not install a second application.

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
| `--password <pw>` | `HERDR_WORLD_PASSWORD` | Generated token for managed non-loopback installs |
| `--socket-path <path>` | `HERDR_SOCKET_PATH` | Default Herdr control socket |
| `--client-socket-path <path>` | `HERDR_CLIENT_SOCKET_PATH` | Default Herdr render socket |
| `--ssh-host <alias>` | `HERDR_SSH_HOST` | Disabled |
| `--session <name>` | `HERDR_SESSION` | Default session |
| `--public-dir <path>` | `PUBLIC_DIR` | Embedded frontend |
| `--public-origin <origin>` | `HERDR_WORLD_PUBLIC_ORIGIN` | Disabled |
| `--log-level <level>` | `HERDR_WORLD_LOG_LEVEL` | `info` |
| `--open` | `OPEN_BROWSER=1` | Disabled |

Loopback listeners intentionally bypass login. A managed non-loopback service creates
a persistent login token unless `HERDR_WORLD_PASSWORD` is set. A token URL establishes
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

World is a trusted single-user administration tool. It does not provide TLS,
rate-limiting, multi-user roles, or a sandbox.

## User service

```bash
herdr-world service install
herdr-world service status
herdr-world service restart
herdr-world service reload
herdr-world service uninstall
```

`service install` listens on `0.0.0.0:8787` and generates a login token. Edit
`~/.config/herdr-world/herdr-world.env` (or the matching `%APPDATA%` file), then
restart. The service identities are:

- Linux: `~/.config/systemd/user/herdr-world.service`
- macOS: `~/Library/LaunchAgents/dev.herdr-world.plist`
- Windows: a per-user `dev.herdr-world-<key>` scheduled task

Verify readiness with `curl -fsS http://127.0.0.1:8787/healthz`. Uninstall preserves
configuration and tokens. The updater installs a checksum-verified replacement and
leaves `herdr-world.previous` for recovery.

## Private remote access

The simplest multi-host arrangement keeps World on the user's computer and adds remote
Herdr servers as SSH profiles. The browser still connects only to the local World
origin. To open the World UI from another trusted device, put an authenticated VPN,
HTTPS reverse proxy, or SSH port forward in front of the World listener. Do not expose
World directly to the public internet.

See the [tutorial](./TUTORIAL.md#remote-access-choose-the-right-connection) for
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
failures.

### Another device cannot open World

Check the printed URL, authentication, listener address, firewall, and outer VPN/proxy
in that order. Binding `127.0.0.1` is intentionally local. Binding `0.0.0.0` requires
the generated token or configured password but still provides no TLS.

### The port is occupied

Only one process can listen on 8787. Stop the old World/Roamgate process or choose
another port with `--port`; do not run two shells for one installation.
