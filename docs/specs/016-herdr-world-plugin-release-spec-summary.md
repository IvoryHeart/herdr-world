# Implementation summary — Herdr World plugin distribution and lifecycle facade

- **Parent spec:** [`016-herdr-world-plugin-release-spec.md`](016-herdr-world-plugin-release-spec.md)
- **Implemented at:** 2026-08-29
- **Implementation status:** Implementation complete; first tagged release validation pending

> The approved parent specification remains immutable. This summary records
> the delivered implementation, decisions, validation evidence, and the
> release-time operational gate.

## Delivered implementation

### 2026-08-29 — Exact npm payload and lifecycle controller

- Added the root `herdr-plugin.toml` for `ivoryheart.herdr-world`, with the
  approved versioned build command and workspace actions: `start`, `stop`,
  `restart`, `status`, `open`, and `doctor`.
- Added `scripts/herdr-world-plugin.sh` and its Node controller. The build
  installs exactly `@ivoryheart/herdr-world@<manifest-version>` into the
  private `.herdr-world-plugin` prefix using npmjs registry pinning,
  `--ignore-scripts`, and no dist-tag or global-package lookup.
- Validated Node.js `22.14.0` or newer, npm, Linux x64/glibc 2.34+, macOS
  ARM64, and macOS x64 before build or runtime use. The selected package,
  native bridge, web assets, launcher, and legal manifest/files are checked
  before the plugin can start.
- Implemented per-session target identities, JSON configuration, atomic
  records and locks, default loopback port `8787`, named-session allocation
  across `8787`–`8877`, explicit remote Host/Origin configuration, and
  redacted human-readable diagnostics.
- Implemented readiness checks against `/api/capabilities` requiring bridge
  API 1, web compatibility 1+, Herdr 0.8.2+, and terminal protocol 20.
- Implemented idempotent lifecycle control with absolute Node paths,
  Herdr-onboarding disabled, systemd `--user` on Linux, launchd on macOS,
  and bounded process-group fallback supervision. Ownership checks refuse to
  signal stale or unrelated processes.
- Kept static assets paired to the private package; only the upload directory
  is configurable. Stop/restart/uninstall messaging distinguishes the bridge
  from the Herdr server and its panes.

### Release and documentation integration

- Updated release version stamping and protected release validation so the
  `v`-prefixed tag and unprefixed plugin/package version remain aligned.
- Added a post-publication `plugin_smoke` release job with the approved full
  three-platform matrix. It downloads checksum-pinned stock Herdr 0.8.2,
  installs the tagged GitHub plugin, exercises its actions and a second
  session/port, and contributes its result to the common release summary.
- Removed the complete distribution matrix from pull-request triggers; the
  explicit workflow-dispatch preflight remains available while ordinary PRs
  use normal CI.
- Documented plugin installation, local-link behavior, configuration,
  security, upgrades, standalone npm/Homebrew/desktop/Android boundaries,
  and release operations. Added the plugin change to `CHANGELOG.md` and
  ignored the generated private payload directory.

## Decisions recorded

- JSON `config.json` in Herdr's injected per-user plugin config directory.
- Default port `8787`; named sessions use the first available port in
  `8787`–`8877` and are documented.
- Hashed stable target identities and service names.
- `open` uses only the platform browser helper, with a headless manual URL
  fallback; no separate `logs` or `url` actions were added.
- The manifest starts at `0.1.0-rc.5` for exact npm payload compatibility; the
  `v0.1.0-rc.5` tag predates this plugin implementation and is not advertised as
  the first tagged plugin release.
- No offline cache or binary-first desktop-artifact installer was added.

## Acceptance evidence

- `herdr plugin link` accepted the manifest and listed all six actions in a
  temporary Herdr configuration.
- A real npm build installed and validated
  `@ivoryheart/herdr-world@0.1.0-rc.5` on Linux without generating a source
  or Rust build.
- Live local checks passed for systemd start/status/restart/stop, doctor,
  action invocation, an isolated named Herdr session, and capability
  readiness. The pre-existing unrelated bridge on port 8787 was left alone.
- `npm run test:release` — passed, including 62 tests and plugin manifest,
  payload, configuration, ownership, readiness, supervisor, and workflow
  coverage.
- `npm run check` — passed, including vendor and notice checks, web lint,
  442 web tests, compatibility and protocol-fixture tests, 162 bridge tests,
  production web build, and bridge build.
- `git diff --check` — passed.

## Constraints and operational notes

- The three-platform published-ref smoke is implemented in CI but cannot be
  fully run from this Linux worktree until a tag containing this implementation
  is published and the matching npm version is available. The release job is
  intentionally gated on npm publication or same-version integrity
  verification.
- The public `herdr-plugin` GitHub topic remains a release-operator decision;
  add it only after the tagged install and three-platform smoke pass.
- No generated `.herdr-world-plugin`, `web/dist`, bridge target, or release
  archive is part of the source changes. Existing user screenshot changes in
  the worktree were preserved untouched.

**Drift from approved spec:** None identified in the implementation; first
tagged post-publication three-platform smoke remains pending.

**Follow-up extension:** None.
