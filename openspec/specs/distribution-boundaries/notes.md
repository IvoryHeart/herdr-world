# distribution-boundaries notes

[Contract](spec.md). Navigation and usage guidance; contracts live in OpenSpec.

**Surfaces:**

- [Real-runtime release walk and pre-tag gate](../../../docs/release.md#real-runtime-release-walk) covers packaged runtime/agent launch journeys and receipts.
- Installers, updates, releases, contributor delivery and the public documentation site.
- Server feature wiring and presence composition: [contributor guide](../../../docs/development.md#verification).

**Code:**

- `scripts/coverage.ts`
- `scripts/coverage.test.ts`
- `quint/models.ts`
- `scripts/features.ts`
- `scripts/build-pages.ts`
- `scripts/pages-features.ts`
- `scripts/openspec-notes.ts`
- `scripts/check-knowledge-map.ts`
- `web/src/features/FeatureHosts.tsx`
- `quint/`
- `docs/design/`
- `docs/evidence/`
- `web/*.html`
- `web/*.test.ts`
- `web/vite.config.ts`
- `web/public/`
- `server/src/features/`
- `server/src/features/contract.ts`
- `server/src/features/compose.ts`
- `server/src/features/presence/register.ts`
- `server/src/testing/`
- `web/src/features/`
- `web/src/testing/`
- `scripts/release-walk.ts`
- `scripts/release-walk-gate.ts`
- `scripts/release-walk/`
- `scripts/prepare-release.ts`
- `scripts/prepare-release.test.ts`
- `server/src/config/service-discovery.ts`
- `server/src/config/service-uninstall.test.ts`
- `scripts/`
- `.github/workflows/`
- `.githooks/`
- `site/`

**Tests:**

- `scripts/pages-features.test.ts`
- `scripts/pages-workflow.test.ts`
- `scripts/check-knowledge-map.test.ts`
- `server/src/features/compose.test.ts`
- `server/src/service/rpc-dispatch.test.ts`

**Pitfalls:**

- Herdr stays an external runtime. Changes synchronize through reviewed archive PRs.
- Agent discovery starts with native OpenSpec capability and active-change lists,
  then capability specs, notes and their Code paths. Public feature rendering
  belongs to `build:site`; internal notes parsing also serves source-ownership checks.

## Usage reference

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
