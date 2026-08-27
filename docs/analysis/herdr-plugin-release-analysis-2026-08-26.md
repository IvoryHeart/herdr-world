# Herdr World plugin release analysis

- **Date:** 2026-08-26
- **Status:** Research complete; implementation not started
- **Repository:** `IvoryHeart/herdr-world`
- **Current application release:** `v0.1.0-rc.1`
- **Current Herdr compatibility:** `v0.8.2` or newer with terminal protocol `20`
- **Decision record:** [Spec 016](../specs/016-herdr-world-plugin-release-spec.md)

## Executive conclusion

Herdr World can be released through Herdr's plugin ecosystem, but it should
not be rewritten as a Herdr-native terminal pane. The viable product shape is:

```text
Herdr plugin manifest and actions
        │
        │ build, start, stop, status, open, restart
        v
Herdr World bridge service
        │
        │ HTTP/WebSocket
        v
Browser, PWA, or Android client
```

The Herdr plugin is a thin registration and lifecycle facade. The existing
React/Pixi application and Rust bridge remain the product. The bridge should
run as a separately supervised user process so that it survives Herdr detach,
client restarts, and Herdr server restarts.

This refines, rather than reverses, the earlier architectural conclusion that
the full World application is a downstream distribution and not a browser
plugin platform. The distinction is important:

- **Herdr World as a product** remains a standalone downstream application.
- **Herdr World as a Herdr plugin release** means adding a plugin facade that
  builds and controls that application.
- The existing browser surfaces remain compiled application surfaces, not
  dynamically registered Herdr UI surfaces.

## Upstream plugin model

The [official Herdr plugin documentation](https://herdr.dev/docs/plugins/)
defines a plugin as a directory containing `herdr-plugin.toml` and executable
commands. Required top-level metadata is:

- `id`
- `name`
- `version`
- `min_herdr_version`

Optional manifest entrypoints include:

- `[[build]]` commands, run during GitHub installation;
- `[[actions]]`, invoked through `herdr plugin action invoke`;
- `[[startup]]` hooks, which are one-shot restoration hooks;
- `[[events]]` hooks;
- `[[panes]]`, which launch terminal processes; and
- `[[link_handlers]]`, which route modified terminal URL clicks to actions.

There is no separate SDK or restricted plugin API. Plugin commands can call
the full Herdr CLI or socket API. Herdr injects `HERDR_SOCKET_PATH`,
`HERDR_BIN_PATH`, plugin identity, config/state directories, and invocation
context. The [socket API documentation](https://herdr.dev/docs/socket-api/)
lists the canonical plugin methods and public runtime methods.

Important constraints:

1. Plugin v1 has no native non-terminal browser UI extension point.
2. A plugin pane is a terminal process, not a React/WebView surface.
3. Startup hooks are not supervised daemons.
4. Plugins run as the installing user, inherit their environment, and are not
   sandboxed.
5. Herdr owns plugin registration, but plugins own their implementation,
   dependencies, config format, state, and cleanup.

These constraints rule out making the Pixel Office or Spaces UI itself a
`[[panes]]` entrypoint. They support a plugin action that starts the existing
web bridge.

## Current ecosystem

The ecosystem is active and includes more than simple shell helpers. At the
time of this analysis:

- the [Herdr marketplace](https://herdr.dev/plugins/) reported 762 plugins
  across 749 repositories;
- GitHub's [`herdr-plugin` topic](https://github.com/topics/herdr-plugin)
  reported 833 public repositories; and
- the marketplace automatically discovers public repositories with the
  `herdr-plugin` topic and a parseable manifest. It refreshes approximately
  every 30 minutes, has no submission queue, and is not a reviewed catalog.

Observed ecosystem categories include:

- terminal TUIs such as file viewers, sidebars, fuzzy navigators, and Git
  tools;
- workflow and worktree automation;
- agent orchestration and lifecycle reporting;
- browser and CDP integrations;
- remote and mobile clients; and
- external-service dashboards.

Two projects are especially relevant:

- [Collie](https://github.com/AltanS/collie) is a PWA plus a Herdr bridge. Its
  [architecture record](https://github.com/AltanS/collie/blob/main/ARCHITECTURE.md)
  explicitly keeps the Herdr plugin thin and runs the bridge under
  `systemd --user` or `launchd`. Its
  [manifest](https://raw.githubusercontent.com/AltanS/collie/main/herdr-plugin.toml)
  uses `[[build]]` and lifecycle `[[actions]]`, without a plugin pane or
  startup daemon.
- [Neon for Herdr](https://github.com/neon-solutions/neon-herdr) demonstrates
  the other major pattern: an application that is genuinely suitable for a
  managed terminal pane. Its Ink dashboard is not analogous to Herdr World's
  browser-first React/Pixi surface, but its build, config, action, and release
  conventions are useful references.

The ecosystem therefore supports Herdr World conceptually, but the precedent
for a browser client says to use a thin action facade and an independently
managed service.

## Fit assessment

| Current Herdr World component | Plugin treatment | Decision |
| --- | --- | --- |
| React/Vite Spaces and Pixel Office | Continue serving from `web/dist` | Reuse unchanged |
| Rust HTTP/WebSocket bridge | Start as a user service | Reuse with a plugin-specific controller |
| Herdr socket connection | Pass the invoking `HERDR_SOCKET_PATH` into the service | Preserve the existing authority boundary |
| Current exact protocol-20 guard | Keep `/api/capabilities` and bridge validation | Required; manifest version alone is insufficient |
| Browser multi-bridge federation | Keep in the browser | Do not add a second Herdr plugin registry |
| Android shell | Remains a companion client | Android is not a Herdr plugin host |
| Launcher onboarding | Keep for desktop tarballs | Do not run interactive setup from plugin actions |
| `[[panes]]` | Do not use for the primary UI | A terminal pane cannot host the current app |
| `[[startup]]` | Do not use for bridge supervision | Startup hooks are one-shot |
| `[[events]]` | Avoid initially | The bridge already consumes Herdr events for live activity |
| `[[actions]]` | Use for lifecycle and diagnostics | Best plugin integration surface |

## Recommended packaging decision

### First release: manifest in this repository

Add a root-level `herdr-plugin.toml` to `IvoryHeart/herdr-world`. This gives
users a direct installation command and keeps the plugin source, bridge, web
assets, compatibility crate, tests, and existing desktop release process in
one source tree:

```bash
herdr plugin install IvoryHeart/herdr-world
```

Use an owner-qualified ID to avoid a collision with future official or
third-party names. A likely ID is:

```text
ivoryheart.herdr-world
```

The first manifest should advertise only the platforms that this repository
currently releases and tests:

```toml
id = "ivoryheart.herdr-world"
name = "Herdr World"
version = "0.1.0-rc.1"
min_herdr_version = "0.8.2"
description = "Browser and mobile client for monitoring and controlling Herdr agents."
platforms = ["linux", "macos"]

[[build]]
command = ["bash", "scripts/herdr-world-plugin.sh", "build"]

[[actions]]
id = "start"
title = "Start Herdr World"
contexts = ["workspace"]
command = ["bash", "scripts/herdr-world-plugin.sh", "start"]

[[actions]]
id = "stop"
title = "Stop Herdr World"
contexts = ["workspace"]
command = ["bash", "scripts/herdr-world-plugin.sh", "stop"]

[[actions]]
id = "restart"
title = "Restart Herdr World"
contexts = ["workspace"]
command = ["bash", "scripts/herdr-world-plugin.sh", "restart"]

[[actions]]
id = "status"
title = "Herdr World status"
contexts = ["workspace"]
command = ["bash", "scripts/herdr-world-plugin.sh", "status"]

[[actions]]
id = "open"
title = "Open Herdr World"
contexts = ["workspace"]
command = ["bash", "scripts/herdr-world-plugin.sh", "open"]
```

The manifest is a design sketch, not yet a validated or committed interface.
The plugin ID, action set, and versioning policy still need owner approval.

### Later option: separate plugin repository

A separate `herdr-world-plugin` repository could eventually provide a smaller
installer that downloads a versioned Herdr World desktop archive and verifies
its checksum. That would make plugin installation faster and avoid requiring
Rust on end-user machines, but it introduces another repository, release
coordination, artifact-download logic, and a second public version surface.

It should be considered only after the source-build plugin has established the
runtime contract. The existing desktop tarballs already make a binary-first
path possible; they do not make it necessary for the first plugin release.

### Rejected option: rewrite as a native plugin pane

This would require replacing the browser application with a terminal UI or a
terminal-graphics implementation. It would lose or substantially compromise
the current responsive browser UI, Pixel Office canvas, multi-bridge browser
federation, and Android client. It is a different product, not a packaging
conversion.

## Required plugin controller

The repository needs a new controller, tentatively
`scripts/herdr-world-plugin.sh`. It should be separate from the current
desktop bundle launcher because `scripts/herdr-world-launcher.sh` assumes the
tarball layout (`bin/` and `share/herdr-world/web/`) and contains interactive
Herdr setup behavior.

The controller should:

1. derive its repository root from its own path;
2. use `HERDR_PLUGIN_CONFIG_DIR` for user-editable settings;
3. use `HERDR_PLUGIN_STATE_DIR` for PIDs, service metadata, and session records;
4. accept the injected `HERDR_SOCKET_PATH` for the Herdr session that invoked
   the action;
5. default to `127.0.0.1` and require explicit configuration for LAN access;
6. start one bridge per Herdr runtime/session, with collision-safe ports;
7. use `systemd --user` on Linux and `launchd` on macOS where available;
8. provide a carefully checked unsupervised fallback only when no user
   supervisor exists;
9. probe `/api/capabilities` after starting instead of treating process launch
   as readiness;
10. print the local URL, target session, Herdr compatibility, and remote access
    posture; and
11. use `HERDR_BIN_PATH` for any controller calls back into Herdr rather than
    assuming that `herdr` is on the action process's `PATH`.

Suggested actions are `start`, `stop`, `restart`, `status`, `open`, and
`doctor`. `url` and `logs` may be useful once the service implementation is
settled. An `update` action should be considered because Herdr v1 has no
separate plugin update command, but it must be designed around managed
checkouts being replaced on reinstall.

## Session and lifecycle model

The current application architecture intentionally has one bridge per Herdr
runtime. The plugin must preserve that rule.

An action invoked inside a Herdr session receives that session's socket path.
The controller should persist a service record keyed by a normalized or hashed
socket identity, containing at least:

- socket path or session name;
- HTTP bind address and port;
- plugin checkout path used by the service;
- service-manager identity;
- bridge PID or readiness metadata; and
- current application/plugin version.

The default session can use the existing `127.0.0.1:8787` convention. Named
sessions need either an explicitly configured port or deterministic allocation
from a safe range. Starting the same profile twice must be idempotent and must
not start a second bridge on the same port.

The browser's existing multi-bridge settings can then connect to multiple
plugin-managed bridge instances. The plugin must not create a fleet registry
or replace the browser's existing host profile owner.

## Build and dependency strategy

### Initial source-build path

The first plugin release can reuse the repository's locked dependency trees
and existing release build steps:

```text
npm ci --prefix web
npm run build:web
cargo build --release --manifest-path bridge/Cargo.toml --bin herdr-web-bridge
```

The manifest should call one controller build action so local linking and
GitHub installation share the same build definition. Herdr runs build commands
during `plugin install`, but does not install Node, Rust, Cargo, or other
toolchains. The plugin README must state the requirements clearly.

The current root `package.json` and `web/package.json` intentionally remain at
`0.0.0`; repository release tags are currently tracked through `release.json`
and public README/Pages references. Adding a plugin manifest creates a real
versioned package contract, so release automation must explicitly stamp and
validate its `version` field without accidentally turning npm package versions
into publishing versions.

### Future binary-first path

After the source-build path is stable, a controller can select the current
platform/architecture, download the matching Herdr World release tarball, and
verify its published SHA-256 file before extracting the bridge and web assets.
This should use immutable release tags or commits and fail closed on unknown
platforms or checksum mismatches.

The binary-first path must also solve managed-checkout replacement, service
restart, version reporting, and release/tag synchronization. It is a release
optimization, not a prerequisite for plugin compatibility.

## Security requirements

The current bridge grants admitted browser clients terminal-equivalent control.
The plugin must make that fact prominent in its install and setup documentation.

Required defaults and safeguards:

- bind loopback by default;
- never infer LAN exposure from the presence of a plugin action;
- require explicit host/origin configuration for non-loopback binding;
- preserve the existing Host, Origin, CSP, upload, and capability checks;
- do not describe Host/Origin checks as authentication;
- recommend an operator-managed VPN, SSH forward, Tailscale, or authenticated
  reverse proxy for remote use;
- keep credentials and durable state out of the managed plugin checkout; and
- make service stop/uninstall behavior explicit so uninstalling a plugin cannot
  leave an unmanaged bridge with access to the Herdr socket.

The Herdr marketplace is an automatic, unreviewed index. A marketplace listing
does not imply a security review or endorsement. This is especially important
for Herdr World because its bridge is intentionally capable of terminal input,
pane mutation, uploads, and agent control.

## Release workflow

The first plugin-enabled release should follow this sequence:

1. Approve the plugin identity, name, platform scope, and version policy.
2. Add `herdr-plugin.toml` and the plugin controller.
3. Add config/state/service lifecycle tests for Linux and macOS.
4. Test local development with `herdr plugin link` and verify that the build
   path is explicit because Herdr does not run `[[build]]` for local links.
5. Test GitHub-style installation from a release ref with Herdr `v0.8.2`.
6. Test default and named Herdr sessions, duplicate starts, restarts, stale
   sockets, incompatible protocol values, and port collisions.
7. Run the existing repository checks and the existing packaged desktop smoke
   suite against a stock Herdr `v0.8.2` daemon reporting protocol `20`.
8. Extend release stamping and validation to check the manifest version,
   `min_herdr_version`, platform list, and release tag.
9. Add plugin installation, configuration, update, uninstall, and security
   guidance to the README and packaging/release documentation.
10. Add the GitHub topic `herdr-plugin` to the public repository.
11. Release from the final tagged commit, then wait for the marketplace index
    refresh and verify the listing metadata.

The marketplace installation form will be:

```bash
herdr plugin install IvoryHeart/herdr-world
```

For reproducible installs, documentation should show a release ref:

```bash
herdr plugin install IvoryHeart/herdr-world --ref vX.Y.Z
```

Herdr has no dedicated v1 plugin update command; refreshing a GitHub-managed
plugin is done by reinstalling it. The controller and documentation must make
the required service restart and managed-checkout behavior unambiguous.

## Open decisions for the next implementation tranche

- Approve `ivoryheart.herdr-world` or choose another plugin ID.
- Decide whether the first plugin version follows the application release tag
  exactly, including prerelease identifiers.
- Decide whether `start` means “current invoking session only” or whether the
  first release also exposes explicit named-session profiles.
- Choose generated `systemd --user`/`launchd` service files versus a smaller
  PID-managed fallback as the initial implementation scope.
- Decide whether `open` should launch the default browser or only print the
  URL, particularly for headless and remote hosts.
- Confirm the release policy for source builds versus prebuilt release assets.
- Confirm that Linux and macOS are the only advertised plugin platforms until
  Windows bridge/service testing exists.

## Sources and related repository decisions

- [Herdr plugin documentation](https://herdr.dev/docs/plugins/)
- [Herdr marketplace documentation](https://herdr.dev/docs/marketplace/)
- [Herdr plugin marketplace](https://herdr.dev/plugins/)
- [Herdr socket API](https://herdr.dev/docs/socket-api/)
- [Herdr CLI reference](https://herdr.dev/docs/cli-reference/)
- [GitHub `herdr-plugin` topic](https://github.com/topics/herdr-plugin)
- [Collie architecture precedent](https://github.com/AltanS/collie/blob/main/ARCHITECTURE.md)
- [Collie plugin manifest](https://raw.githubusercontent.com/AltanS/collie/main/herdr-plugin.toml)
- [Neon for Herdr](https://github.com/neon-solutions/neon-herdr)
- [Existing Herdr World architecture](../architecture.md)
- [Existing Herdr World packaging](../packaging.md)
- [Existing Herdr World release process](../release.md)
- [Earlier upstream/plugin reassessment](upstream-plugin-surface-reassessment-2026-08-20.md)
