# Herdr World plugin distribution and lifecycle facade

- **Spec ID:** `016-herdr-world-plugin-release`
- **Status:** Approved
- **Created:** 2026-08-27
- **Owner:** IvoryHeart / Herdr World
- **Reviewers:** IvoryHeart (repository owner)
- **Approved by:** IvoryHeart
- **Approved at:** 2026-08-29

> This document may be edited only while its status is `Draft` or `In review`.
> After approval it is immutable. After implementation completes, record
> delivery and drift in `016-herdr-world-plugin-release-spec-summary.md`; put
> later intended changes in a numbered extension.

## 1. Purpose

Herdr World currently ships as a downstream browser/mobile application with a
Rust HTTP/WebSocket bridge. Users must install or unpack that application and
start the bridge independently of Herdr. This specification defines the
smallest Herdr plugin integration that makes the existing application
installable and operable through Herdr's plugin ecosystem without changing its
browser-first product shape.

The outcome is a public Herdr plugin that installs the exact version-matched
`@ivoryheart/herdr-world` npm payload inside its managed checkout, starts one
bridge service for the invoking Herdr runtime, reports its state, and gives the
user a URL for the browser or PWA client. The standalone npm, Homebrew, desktop
tarball, and Android distributions remain supported products.

The companion research and ecosystem record is
[Herdr plugin release analysis](../analysis/herdr-plugin-release-analysis-2026-08-26.md).
That analysis predates this approved npm-payload decision; its source-build-first
packaging recommendation is superseded by this specification.
The integration relies on the [Herdr plugin manifest and runtime contract](https://herdr.dev/docs/plugins/),
the [Herdr socket/CLI API](https://herdr.dev/docs/socket-api/), and the
[automatic marketplace listing rules](https://herdr.dev/docs/marketplace/).

## 2. Scope

This feature includes:

- a root-level `herdr-plugin.toml` in this repository;
- plugin metadata for `ivoryheart.herdr-world`, versioned with the application
  release version and requiring Herdr `0.8.2` or newer;
- Linux x86-64 with glibc `2.34` or newer, macOS ARM64, and macOS x86-64 plugin
  support, matching the published npm payload matrix;
- a plugin controller at `scripts/herdr-world-plugin.sh`;
- install-time acquisition of the exact release-matched
  `@ivoryheart/herdr-world` npm payload into a private plugin-local prefix;
- lifecycle and diagnostic actions for starting, stopping, restarting,
  inspecting, opening, and diagnosing the bridge;
- service state and editable configuration stored outside the managed plugin
  checkout;
- one bridge instance per Herdr runtime/session, using the invoking
  `HERDR_SOCKET_PATH` unless an explicitly configured session target is used;
- loopback-safe defaults, explicit remote-access configuration, readiness
  probing, and actionable diagnostics;
- automated controller tests and manual Herdr plugin install/link smoke tests;
- release validation that keeps the manifest, tagged application release, and
  npm payload versions aligned and validates the plugin after npm publication;
- documentation for installation, configuration, actions, upgrades,
  uninstall, security, and the relationship to the existing tarballs and
  Android client.

## 3. Non-goals

- Rewriting Pixel Office, Spaces, or the React/Pixi application as a terminal
  UI or a Herdr `[[panes]]` entrypoint.
- Adding a WebView, browser surface registry, or native non-terminal plugin UI
  to Herdr.
- Making Herdr responsible for supervising a long-running bridge through a
  `[[startup]]` hook. Startup hooks are one-shot initialization commands, not
  daemon supervisors.
- Replacing the browser's existing multi-bridge federation or creating a
  second host/session registry in the plugin.
- Turning Android into a Herdr plugin host. Android remains a companion client
  that connects to a configured bridge.
- Removing or changing the desktop tarball launcher, its consent-based Herdr
  setup behavior, or its documented artifact layout.
- Shipping a separate plugin repository or downloading desktop archives from a
  plugin-specific installer.
- Rebuilding the web application or native bridge during plugin installation.
- Using a global npm or Homebrew installation as the plugin runtime, or making
  Homebrew a plugin prerequisite.
- Supporting Windows before the bridge controller and service lifecycle are
  implemented and tested on that platform.
- Adding plugin-owned credentials, authentication, or a claim that Host,
  Origin, and CSP checks authenticate browser users.
- Adding plugin event hooks, link handlers, or a persistent terminal pane in
  the initial release. These can be separately specified if a concrete use
  case emerges.

## 4. Context and constraints

### Existing application boundary

Herdr World is an independent downstream application. The bridge currently
owns the Herdr socket connection and exposes the browser API at a configured
HTTP/WebSocket address. The browser already supports multiple bridge profiles;
the plugin must provide one predictable bridge endpoint rather than duplicate
that federation logic.

The current bridge requires Herdr `v0.8.2` or newer and exact terminal protocol
`20`. The plugin manifest's `min_herdr_version` is only an installation gate;
the bridge's existing runtime version/protocol admission remains authoritative.

### Herdr plugin constraints

Herdr plugins are ordinary user code. Build and runtime commands are argv
arrays, run with the installing user's permissions, and are not sandboxed.
Herdr runs `[[build]]` commands during GitHub installation but does not run
them for `plugin link`; local authors build linked checkouts themselves. Herdr
injects `HERDR_BIN_PATH`, `HERDR_SOCKET_PATH`, plugin config/state directories,
and invocation context into runtime commands. Plugin-managed source checkouts
are replaceable and must not contain durable user data.

The first manifest is intentionally an action facade. The existing browser
application cannot be represented by a terminal pane, and a terminal pane's
lifecycle is unsuitable for a bridge that should survive Herdr client detach,
browser reload, or Herdr server handoff.

### Release and repository constraints

The repository's public application release tag is the source of truth. Root
and web development manifests remain private at version `0.0.0`; the release
workflow generates and publishes the separate public
`@ivoryheart/herdr-world` package at the release version. Plugin version
stamping remains an explicit release concern and SHALL agree with that
generated package rather than either private development manifest.

Release `v0.1.0-rc.5` established the distribution baseline: the exact npm
package is public, the Homebrew RC Formula is published and validated, and the
GitHub release contains all three desktop archives and checksums. RC5 is
implementation and validation evidence, not a permanently fixed plugin
version.

Herdr installs marketplace plugins from GitHub and runs their `[[build]]`
commands; it does not install Herdr plugins directly from npm. The root
manifest and controller therefore remain in this repository while the
version-matched npm package supplies the prebuilt application payload. The
package contains the verified web assets, legal payload, and bridges for Linux
x86-64, macOS ARM64, and macOS x86-64. Plugin installation requires Node.js
`22.14.0` or newer and npm. Node.js remains a runtime dependency of the
packaged launcher and must stay available to plugin actions and the user
supervisor after installation. The plugin SHALL NOT require Rust, Cargo, a
native compiler, or the web development dependency tree.

Herdr's manifest platform field distinguishes operating systems but not CPU or
Linux libc. The controller SHALL enforce the narrower published payload
matrix.

## 5. Requirements

### Requirement: Provide a valid root plugin manifest

The repository SHALL contain a root `herdr-plugin.toml` with the following
initial contract:

| Field | Required value |
| --- | --- |
| `id` | `ivoryheart.herdr-world` |
| `name` | `Herdr World` |
| `version` | current application version without the leading `v` |
| `min_herdr_version` | `0.8.2` |
| `platforms` | `["linux", "macos"]` |
| `[[build]]` | invokes `bash scripts/herdr-world-plugin.sh build` |
| action commands | invoke the same controller with the action name |

The manifest SHALL declare the `start`, `stop`, `restart`, `status`, `open`,
and `doctor` actions with `contexts = ["workspace"]`. The manifest SHALL NOT
declare a primary `[[panes]]`, `[[startup]]`, or `[[events]]` entry in the
initial release.

#### Scenario: Herdr parses the manifest

- **GIVEN** a supported Herdr installation and the repository checkout
- **WHEN** the user runs `herdr plugin link` or installs the repository from
  GitHub
- **THEN** Herdr accepts the manifest, exposes all six actions, and reports no
  missing required metadata or unsupported platform declaration.

#### Scenario: An unsupported Herdr version is used

- **GIVEN** a Herdr binary older than `0.8.2`
- **WHEN** the user attempts to link or install Herdr World
- **THEN** Herdr refuses the plugin using its normal minimum-version error
  before any plugin build or runtime action executes.

### Requirement: Install the exact released application payload

The `build` controller action SHALL read the plugin version from the root
manifest and install exactly
`@ivoryheart/herdr-world@<manifest-version>` into the deterministic private
prefix `.herdr-world-plugin/` under the managed plugin checkout. It SHALL use
the equivalent of:

```text
npm install --registry=https://registry.npmjs.org/ \
  --@ivoryheart:registry=https://registry.npmjs.org/ \
  --prefix .herdr-world-plugin --ignore-scripts --no-save \
  --package-lock=false --no-audit --no-fund --omit=dev \
  @ivoryheart/herdr-world@<manifest-version>
```

The build SHALL use an exact version, never an npm dist-tag, `npx`, a global
installation, or a package selected from the ambient `PATH`. It SHALL disable
package lifecycle scripts and SHALL NOT run a web build, Cargo, a native
compiler, an installer embedded in another distribution, or Herdr onboarding.
It SHALL pin both the default registry and the `@ivoryheart` scope to
`https://registry.npmjs.org/` at npm's command-line configuration precedence
so user, project, global, environment, or scope registry configuration cannot
redirect the native payload request or any dependency request to another
registry.

Before installation the build SHALL fail closed unless Node.js `22.14.0` or
newer and npm are available and the current OS, architecture, and Linux libc
are supported. After installation it SHALL verify the installed package name
and version, the private `node_modules/.bin/herdr-world` entrypoint, packaged
web assets, selected native bridge, and required legal payload. A missing
registry version, engine mismatch, unsupported target, package mismatch, or
incomplete payload SHALL abort installation before Herdr registers the plugin.

The resulting package root and executable SHALL be deterministic:

- package root:
  `.herdr-world-plugin/node_modules/@ivoryheart/herdr-world/`;
- executable: `.herdr-world-plugin/node_modules/.bin/herdr-world`.

Generated package files SHALL remain inside `.herdr-world-plugin/` and SHALL
not be committed. npm's integrity verification against the package metadata
served by the pinned npmjs registry, together with the release workflow's
recorded package integrity, remain authoritative for the payload.

#### Scenario: A GitHub installation acquires the package successfully

- **GIVEN** a clean checkout, Node.js `22.14.0` or newer, npm, a supported
  target, the exact manifest-version package published on npm, and a compatible
  Herdr installation
- **WHEN** Herdr runs the manifest build command during `plugin install`
- **THEN** the exact prebuilt payload is installed and validated at the
  documented private paths, no source or native build runs, and the plugin is
  registered only after installation succeeds.

#### Scenario: Local linking is used

- **GIVEN** a linked checkout with no private npm payload
- **WHEN** the user invokes an action
- **THEN** the controller prints that local linking does not run manifest build
  commands and provides the exact payload-install command; it does not use a
  global package, a dist-tag, or silently build from source.

### Requirement: Start one bridge for one Herdr runtime

The `start` action SHALL:

1. Resolve the target socket from the invocation's `HERDR_SOCKET_PATH`, unless
   the user has explicitly configured a named session or socket target.
2. Use only the exact private npm payload installed for the manifest version;
   it SHALL not resolve `herdr-world` from the ambient `PATH`.
3. Bind to `127.0.0.1` by default on port `8787` for the default profile.
4. Allocate or validate a distinct port for another concurrently managed
   runtime; it SHALL never attach a second bridge to the same service record.
5. Pass the target session/socket and bridge security options explicitly to the
   bridge rather than relying on the controller's ambient working directory.
6. Store a service record keyed by a stable, non-secret identity for the
   Herdr runtime/session.
7. Start under `systemd --user` on Linux and `launchd` on macOS when the
   applicable user supervisor is available.
8. Use a bounded, checked process fallback only when no supported user
   supervisor is available.
9. Wait for `/api/capabilities` and verify the expected Herdr version/protocol
   and web compatibility before reporting success.
10. Print the bridge URL, target session, bridge/Herdr compatibility, and
    whether the endpoint is loopback-only or remotely exposed.

The controller SHALL supervise the package's foreground `herdr-world`
entrypoint with Herdr onboarding explicitly disabled. The package entrypoint
remains responsible for selecting its verified native bridge and bundled web
assets. The controller SHALL pass the selected Herdr target and all bridge
security options explicitly and SHALL reject a missing or version-mismatched
private payload before creating supervisor state.

Before starting or restarting a service, the controller SHALL resolve an
absolute Node.js executable, verify that it is version `22.14.0` or newer, and
place that exact executable in the supervisor command rather than depending
on `#!/usr/bin/env node` or the supervisor's `PATH`. `doctor` SHALL perform the
same check without starting anything and report whether the recorded Node path
still exists and meets the version floor. `start`, `restart`, and `doctor`
SHALL fail closed with an actionable diagnostic when Node is absent, too old,
or unavailable to the selected supervisor environment.

The controller SHALL be idempotent. If a healthy matching service already
exists, `start` SHALL report it and return success without spawning another
bridge. If a recorded service is stale or incompatible, it SHALL not kill an
unrelated process; it SHALL either recover the owned service or return an
actionable diagnostic.

#### Scenario: First start uses the invoking session

- **GIVEN** a running Herdr session and its injected
  `HERDR_SOCKET_PATH`, with no World service record
- **WHEN** the user invokes the `start` action
- **THEN** the controller starts one bridge against that socket, waits for a
  successful capability probe, records the endpoint, and prints a usable local
  URL.

#### Scenario: Start is repeated

- **GIVEN** a healthy bridge owned by the current plugin profile
- **WHEN** the user invokes `start` again
- **THEN** the controller returns success, reports the existing endpoint, and
  leaves the original bridge and service record intact.

#### Scenario: The Herdr socket is unavailable

- **GIVEN** no usable target socket for the selected profile
- **WHEN** the user invokes `start`
- **THEN** the controller fails before claiming readiness, names the selected
  target, explains how to start/select Herdr, and does not leave a running
  bridge process behind.

### Requirement: Expose safe lifecycle actions

The controller SHALL implement these action behaviors:

| Action | Behavior |
| --- | --- |
| `start` | Ensure the selected bridge is running and ready; print its endpoint. |
| `stop` | Stop only the selected plugin-owned service; succeed idempotently when absent. |
| `restart` | Stop and start the selected service, then verify readiness. |
| `status` | Report service ownership, target, pid/supervisor state, endpoint, and capability state without starting anything. |
| `open` | Ensure the service is ready, print the URL, and request the platform default browser when one is available; remain usable on headless hosts. |
| `doctor` | Run non-destructive checks for platform, tools, Herdr target, private payload, config, state, service ownership, port, and capability compatibility. |

Action output SHALL be human-readable by default and SHALL never print
credentials, full socket contents, or arbitrary environment values. Failures
SHALL identify the failed check and a bounded next action. `stop`, `restart`,
and uninstall guidance SHALL state that stopping the bridge disconnects
browser clients but does not stop the Herdr server or its panes.

#### Scenario: Stop cannot target an unrelated process

- **GIVEN** a service record whose pid or command no longer matches the
  controller's recorded bridge identity
- **WHEN** the user invokes `stop`
- **THEN** the controller refuses to signal that process, reports stale state,
  and leaves the unrelated process untouched.

#### Scenario: Open runs without a desktop browser

- **GIVEN** a ready bridge on a headless host
- **WHEN** the user invokes `open`
- **THEN** the controller prints the URL and remote-access posture without
  treating the absence of `xdg-open` or `open` as a bridge failure.

### Requirement: Keep configuration and state outside the managed checkout

The controller SHALL use Herdr's injected `HERDR_PLUGIN_CONFIG_DIR` for
editable configuration and `HERDR_PLUGIN_STATE_DIR` for service records,
supervisor metadata, logs/pointers, and migration state. It SHALL create
directories with user-only permissions where the platform supports them.

Configuration SHALL support, at minimum:

- bind host, default port or a safe port range;
- optional explicit Herdr session/socket target;
- an upload directory override only when explicitly needed;
- allowed hosts/origins for non-loopback use; and
- optional bridge label.

The packaged static assets SHALL not be replaceable through initial plugin
configuration; their version must remain paired with the packaged bridge.

The controller SHALL validate ports, paths, session names, hosts, origins, and
platform values before launching the bridge. It SHALL not write editable
configuration, credentials, or durable runtime records under
`HERDR_PLUGIN_ROOT`.

#### Scenario: A managed checkout is replaced

- **GIVEN** a configured plugin whose GitHub installation is reinstalled
- **WHEN** Herdr replaces the managed plugin checkout
- **THEN** the controller retains the user's config/state, detects any service
  whose executable path changed, and provides a safe restart or migration
  result rather than silently running deleted code.

### Requirement: Preserve bridge security posture

The plugin SHALL default to loopback binding and SHALL require explicit host
and origin configuration for any non-loopback bind. It SHALL pass those values
through the bridge's existing validation; it SHALL not weaken upload limits,
Host/Origin checks, CSP, capability checks, or protocol admission.

The plugin documentation and action diagnostics SHALL state that an admitted
browser has terminal-equivalent control and that Host, Origin, and CSP checks
are not authentication. Remote use SHALL recommend an operator-managed
authenticated reverse proxy, VPN, SSH forwarding, or equivalent access
boundary.

#### Scenario: LAN exposure is requested incompletely

- **GIVEN** a configuration binding to a non-loopback host without explicit
  allowed host and origin values
- **WHEN** `start` or `doctor` evaluates the configuration
- **THEN** it fails before starting or exposing the bridge and names both
  required classes of configuration.

#### Scenario: Default configuration is used

- **GIVEN** no host or origin override
- **WHEN** `start` launches the bridge
- **THEN** it binds to loopback only and reports that posture in its output.

### Requirement: Align plugin and application release versions

The release process SHALL treat the plugin manifest version as a public
release reference. Before a release commit is created, static validation SHALL
prove that:

- the manifest version equals the application release version without `v`;
- the version is exactly `X.Y.Z` or `X.Y.Z-rc.N`;
- `min_herdr_version` and the advertised platform list are intentional;
- all declared controller entrypoints exist and are executable;
- the build controller derives the exact npm package version from the manifest
  and cannot select a dist-tag or global installation; and
- the plugin introduces no second release command or independently rebuilt
  application artifact.

After the release workflow publishes or verifies the exact npm package, its
plugin job SHALL install the tagged GitHub plugin, exercise the declared
actions, and include the plugin version, result, and public URL in the common
release summary. The plugin job SHALL depend on successful npm publication or
same-version integrity verification; it SHALL not publish, rebuild, or
substitute an application payload itself. Explicit manual validation runs MAY
use the exact generated npm tarball but SHALL NOT publish or advertise the
plugin. Ordinary pull requests rely on the normal CI release tests and do not
run the complete distribution matrix.

The release documentation SHALL explain both installation forms:

```bash
herdr plugin install IvoryHeart/herdr-world
herdr plugin install IvoryHeart/herdr-world --ref vX.Y.Z
```

It SHALL explain that plugin installation requires Node.js `22.14.0` or newer
and npm to acquire the exact prebuilt payload, that Node must remain installed
for the supervised package launcher, that Rust and Cargo are not required, and
that global npm and Homebrew installations are ignored. It SHALL also explain
that local linking does not run build commands and reinstalling is Herdr v1's
refresh mechanism for a GitHub-managed plugin. The repository SHALL add the
GitHub topic `herdr-plugin` only when the tagged install flow succeeds against
the published matching npm package and is ready for public discovery.

#### Scenario: A release version drifts

- **GIVEN** `release.json`, the manifest, the generated npm package, or another
  public release reference names different versions
- **WHEN** release validation runs
- **THEN** it fails with the mismatched paths and does not create or publish a
  release commit or tag.

### Requirement: Preserve standalone distributions

The plugin SHALL install its own exact npm payload inside the managed checkout.
It SHALL not require, discover, modify, or remove a global npm package,
Homebrew Formula, desktop tarball installation, or Android client. Existing
tarball packaging SHALL continue to use its bundled `bin/herdr-world` launcher
and `bin/herdr-world-bridge`; plugin actions SHALL use only the private package
installed for the manifest version.

Documentation SHALL distinguish:

- the Herdr plugin as a lifecycle/install facade;
- the browser/PWA as the main World client;
- the Android application as a companion client; and
- npm, Homebrew, and the desktop tarball as independently usable
  distributions.

#### Scenario: Existing tarball packaging is checked

- **GIVEN** the plugin manifest and controller are present
- **WHEN** the documented desktop packaging check runs
- **THEN** the tarball still contains its documented files, does not require a
  plugin-managed checkout, and its launcher behavior remains unchanged.

#### Scenario: A standalone installation is present

- **GIVEN** a different Herdr World version is installed globally through npm
  or Homebrew
- **WHEN** a plugin action runs
- **THEN** the controller uses its manifest-matched private payload and leaves
  the standalone installation unchanged.

## 6. Data and interface contract

### Manifest contract

The initial manifest has one build entry and six workspace-scoped action
entries. All commands SHALL be argv arrays and SHALL invoke the controller by
path. The controller SHALL derive the repository root from its own location,
so its behavior does not depend on Herdr's current working directory.

The manifest version is a SemVer value without the leading release-tag `v` and
SHALL have exactly one of these forms:

```text
MAJOR.MINOR.PATCH
MAJOR.MINOR.PATCH-rc.NUMBER
```

The Git tag and application release metadata retain their existing `v` prefix.
No other prerelease identifier or build metadata is allowed.

### Controller invocation contract

The controller SHALL accept exactly:

```text
build | start | stop | restart | status | open | doctor
```

Unknown or missing commands SHALL return a usage error without side effects.
Runtime actions SHALL use `HERDR_BIN_PATH` for calls back into Herdr and SHALL
honor `HERDR_SOCKET_PATH` as the default target. The controller SHALL not
assume `herdr` is on `PATH` and SHALL not parse human-oriented Herdr output
when a stable CLI/socket response is available. It SHALL resolve the
application entrypoint only from the deterministic private npm prefix and run
it with Herdr onboarding disabled.

### Service record contract

Each managed runtime record SHALL be stored as a versioned, atomically written
file under `HERDR_PLUGIN_STATE_DIR`. The schema SHALL include at least:

```json
{
  "schema_version": 1,
  "target_identity": "opaque-stable-profile-id",
  "session_name": "default",
  "socket_path": "/path/to/herdr.sock",
  "host": "127.0.0.1",
  "port": 8787,
  "url": "http://127.0.0.1:8787",
  "package_name": "@ivoryheart/herdr-world",
  "package_version": "0.1.0-rc.5",
  "payload_root": "/managed/checkout/.herdr-world-plugin/node_modules/@ivoryheart/herdr-world",
  "payload_entrypoint": "/managed/checkout/.herdr-world-plugin/node_modules/.bin/herdr-world",
  "node_path": "/absolute/path/to/node",
  "supervisor": "systemd-user|launchd|fallback",
  "service_name": "opaque-owned-service-name",
  "pid": 12345,
  "application_version": "0.1.0-rc.5",
  "herdr_protocol": 20,
  "updated_at": "RFC-3339 timestamp"
}
```

The package version shown above is illustrative; every record SHALL contain the
actual manifest-matched version. The exact identity derivation, filename,
supervisor unit/plist contents, and config file format are implementation
details, but they SHALL be documented and tested. Socket paths and records are
local control data; diagnostics must redact them when full disclosure is not
required.

### Readiness contract

`start` and `restart` are successful only after an HTTP request to the selected
bridge's `/api/capabilities` returns a valid response with the expected bridge
API/web compatibility and Herdr terminal protocol `20`. A listening TCP port
or live process without a valid capability response is not readiness.

## 7. Privacy and security

- Plugin installation and build commands execute arbitrary repository code as
  the installing user and acquire a prebuilt native npm payload. README and
  install documentation SHALL direct users to inspect the manifest,
  controller, exact npm version, and release provenance before confirming
  installation.
- The marketplace topic and listing are discovery metadata, not a security
  review or endorsement.
- npm installation SHALL disable lifecycle scripts and remain inside the
  managed checkout. The build SHALL pin the default registry and the
  `@ivoryheart` scope to the public npmjs registry and SHALL not trust registry
  integrity metadata from an operator-configured alternate registry. Runtime
  actions SHALL neither resolve nor mutate a global package or Homebrew
  installation.
- No secret may be placed in the manifest, plugin checkout, service command
  line, or ordinary action output.
- Config/state directories SHALL be user-scoped and excluded from repository
  commits and release archives.
- Non-loopback binding SHALL be opt-in and visibly reported.
- The plugin SHALL stop or orphan-check its own bridge during uninstall
  guidance so uninstall cannot knowingly leave a bridge with access to the
  Herdr socket.
- The controller SHALL use bounded timeouts for process startup, readiness,
  stop, supervisor operations, and HTTP probes.
- The controller SHALL not broaden bridge command exposure; command and
  parameter allow-lists remain bridge-owned in `web_bridge.rs`.

## 8. Acceptance evidence

Implementation is complete only when the pull request contains the following
evidence:

### Static and unit validation

- manifest parsing/validation tests cover required metadata, action IDs,
  platform fields, version alignment, and missing entrypoints;
- payload installation tests cover the exact package selector, Node.js floor,
  supported OS/architecture/libc matrix, disabled lifecycle scripts, private
  prefix, missing registry version, mismatched package metadata, incomplete
  payload, command-line pinning of the default registry and `@ivoryheart`
  scope to npmjs despite conflicting configuration, and refusal to use
  dist-tags or global installations;
- controller tests cover argument validation, config/state paths, atomic
  records, package-version ownership, port allocation, idempotent start, stale
  ownership, readiness failure, absolute Node resolution, missing/old/removed
  Node behavior, supervisor environment isolation, redaction, and security
  defaults;
- Linux supervisor behavior is tested with deterministic fakes for
  `systemd --user`, and macOS behavior with deterministic fakes for `launchd`;
- fallback supervision is tested for bounded shutdown and stale-process
  refusal;
- release tests cover manifest version stamping, exact npm payload derivation,
  post-publication plugin job ordering, and mismatch failure; and
- `git diff --check`, `npm run test:release`, and the repository's normal
  `npm run check` pass when the implementation is complete.

### Herdr integration smoke

Against a local Herdr `v0.8.2` daemon reporting terminal protocol `20`, the
implementation SHALL demonstrate:

1. `herdr plugin link` followed by explicit installation of the exact private
   npm payload;
2. GitHub-style installation from a release ref after the matching npm version
   is published or verified;
3. action listing and invocation;
4. first start, repeated start, status, open, restart, and stop;
5. browser load through the reported URL;
6. terminal attach, snapshot, event observation, input, resize, scrolling,
   upload, pane operations, and World surface load;
7. two browser clients attached to the same bridge;
8. two distinct Herdr sessions with isolated service records and ports;
9. incompatible protocol, missing socket, stale process, and port collision
   failures;
10. uninstall/refresh behavior with service cleanup and retained config/state;
11. a different globally installed npm or Homebrew version remaining unused
    and unchanged; and
12. unsupported architecture, musl or unknown libc, missing Node/npm during
    installation, missing or old Node during runtime, missing package version,
    alternate scoped-registry configuration, and package/manifest mismatch
    failures without a service.

The existing `npm run check:acceptance` and packaged desktop smoke suite remain
required. The existing npm install tests and Homebrew Formula validation SHALL
remain green. Plugin-specific tests may use fakes for supervisors and HTTP
probes, but the final smoke must use an unmodified compatible Herdr daemon and
the exact published package for the selected release.

### Marketplace readiness

Before adding the public `herdr-plugin` topic, confirm from a clean default
branch that:

- the root manifest parses with the minimum supported Herdr;
- a reviewer can inspect every build/runtime command;
- npm-payload prerequisites, exact-version behavior, prebuilt-code trust, and
  security posture are documented;
- the default branch contains the versioned manifest and controller; and
- `herdr plugin install IvoryHeart/herdr-world --ref vX.Y.Z` succeeds for the
  tagged release using the matching published npm package.

## 9. Deferred decisions

These choices do not block the architecture or initial implementation, but an
implementation PR SHALL record its selected value in the delivery summary:

- the exact config file format (`key=value`, TOML, or another small format);
- the deterministic named-session port allocation range and whether named
  sessions are exposed in the first user-facing documentation;
- the exact `systemd --user` unit and `launchd` label naming scheme;
- whether `open` uses only platform browser helpers or supports an explicit
  `HERDR_WORLD_BROWSER` override;
- whether `logs` and `url` become separate actions or remain part of `status`
  and diagnostics; and
- whether an explicit offline package-cache input is needed after the public
  registry path is established and measured.

The following are intentionally not deferred: the thin-facade architecture,
root-repository manifest, plugin ID, exact npm-payload strategy, private
plugin-local installation, loopback default, Herdr protocol-20 gate,
external config/state ownership, and the Linux x86-64/glibc 2.34+, macOS
ARM64, and macOS x86-64 initial target matrix.

## Related repository documentation

- [Herdr World plugin release analysis](../analysis/herdr-plugin-release-analysis-2026-08-26.md)
- [Automated release distribution](017-herdr-world-automated-release-distribution-spec.md)
- [World packaging and upstream boundaries](004-world-packaging-and-upstream-boundaries-spec.md)
- [Development](../development.md)
- [Packaging](../packaging.md)
- [Release process](../release.md)
- [Architecture](../architecture.md)
