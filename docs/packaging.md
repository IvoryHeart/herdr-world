# Packaging

Release archives contain one compiled `herdr-world` executable, embedded web
assets, version, lineage and licence material. Runtimes are separate. See the
[runtime support table](../openspec/specs/herdr-core-runtime/notes.md#runtime-support).

The executable pins a verified **Herdr TUI** release and its platform/Windows
installer checksums in `server/src/herdr/release.ts`. Fresh standalone installs
and Homebrew's first normal launch keep either installed runtime. With neither,
they install **herdr-core** using its checksum-verified official steps
(`scripts/herdr-core-install.sh` and its Windows PowerShell twin), start it now
and at login, and save its connection. Homebrew has no mandatory Herdr formula
dependency and installs core outside its keg, without an Intel source build.
With core already installed and no Herdr TUI, World's first run discovers and
saves the local core as its default without changing the runtime or its login item.

Standalone replacements and World updates refresh the TUI and its integrations,
then restart the matching managed World service. Homebrew services use the validated
opt path; formula post-install finalization refreshes a running service from the
same formula before old-keg cleanup. Installed core is left unchanged;
upgrade it with core's own tools. `HERDR_WORLD_SKIP_HERDR=1` skips runtime changes
while allowing World's restart. World's harness skills and Claude limits tap
refresh separately; `HERDR_WORLD_SKIP_INTEGRATIONS=1` skips those. Explicitly
removed World integrations stay removed. See
[setup and upgrades](DEPLOYMENT.md#herdr-installation-and-upgrades).

`bun run test:install-linux` verifies real runtime downloads, systemd login/reboot
startup, core-only connections, TUI preservation and stable World upgrades in
disposable containers. The [runbook](development.md#linux-installation-acceptance)
and [release gate](release.md#linux-systemd-installation-gate) define acceptance.

The executable also embeds the SQLite writer worker. Every compile target lists
`server/src/storage/world-worker.ts` as an additional entry point; no adjacent
worker source file or external Bun installation is required. The compiled client
resolves `storage/world-worker.ts` relative to the bundled main entry; source
execution resolves the sibling module. The crash fixture deliberately places
its entry outside `storage/` and uses release minify/source-map flags, so it
exercises that packaged layout with the production worker. The native installer
matrix runs the storage crash suite on all six release targets for native PR inputs and nightly main, including a
standalone compiled fixture copied away from its source. It records the SQLite
version actually linked by each platform; a Bun version alone does not establish
identical SQLite versions or filesystem durability behavior across platforms.

The web build is limited to 190 files and 15.3 MiB total embedded assets,
including lazy features such as Ranger, commit history, the diff worker, the
Town and Board views and PDF.js with its worker, which load only when a browser
without a PDF viewer opens a PDF. Startup limits remain 660 KiB
JavaScript (202 KiB gzip) and 196 KiB CSS. The Code view and Settings' IDE
rows share one lazy chunk; neither adds to the eager graph.
Small highlighting themes share a
lazy chunk to control file count. `bun run build` enforces these limits, and it
fails when a static import elsewhere keeps a lazy import in the eager chunk,
when PDF.js reaches the initial load, or when the shipped PDF.js compiles code
at run time.

From an installed, clean checkout:

```bash
bun run notices:check
HERDR_WORLD_BUILD_VERSION=X.Y.Z bun run package:linux-x64
```

Available targets are `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`,
`windows-x64` and `windows-arm64`. Bun cross-compiles the executable; package output
is written to ignored `dist/` as a versioned archive, a latest-channel archive,
checksums and an update manifest.
`HERDR_WORLD_BUILD_VERSION` accepts `X.Y.Z` and `X.Y.Z-rc.N`; candidates use the
same six targets and archive layout.

Each archive must contain:

- the platform executable and `VERSION` file;
- `LICENSE`, `THIRD_PARTY_NOTICES.md`, `DEPENDENCY_NOTICES.md`,
  `DEPENDENCY_LICENSES.md` and `LICENSES/`;
- `UPSTREAM.md` with the exact Roamgate synchronization point.

Inspect the archive and validate its checksum before publication. Never commit
archives, extracted package directories or compiled binaries. Main's reusable release candidate
workflow builds every supported target once and runs
[`scripts/verify-release-package.sh`](../scripts/verify-release-package.sh) on each
archive. It checks the executable header's format and native machine ID rather than
`file` output, whose wording changes between versions; every native archive is installed and launched to verify its served behavior.

The same verified archives feed six public npm platform packages and the
`@ivoryheart/herdr-world` launcher. npm selects one binary through optional
dependencies and runs no install script; Node.js 22.14.0 or newer is required for
the launcher. The candidate workflow also generates a checksum-pinned Homebrew
Formula for macOS and Linux and opens a reviewable PR in
`IvoryHeart/homebrew-tap` after the GitHub assets are published. Windows uses npm
or the standalone archive; Homebrew does not manage Windows.
Candidates publish to npm's `next` tag and the separate `herdr-world-rc` Formula.

The responsive Web/PWA is the supported mobile artifact. This foundation does not
produce the former Capacitor Android package.

Released Herdr plugins reuse these checksum-verified archives without external Bun.
The platform installer checks the manifest's exact version and native `plugin`
commands, then installs the World executable and a copy named
`server/herdr-world-plugin.exe`. The latter preserves cached action argv and routes
service operations through the canonical executable. No second release artifact
or bundled Herdr runtime is needed. Unreleased source builds and local linking
continue to use Bun through `scripts/world-plugin.ts build-source`.

Native compatibility acceptance compiles an isolated fixture with an empty PATH
and verifies the cached action verbs over HTTP and HTTPS. Its asynchronous
lifecycle awaits the existing bounded installer-fixture cleanup, yielding between
retryable filesystem failures. Persistent cleanup failures still fail the test;
if the body also fails, an `AggregateError` retains both original errors. Fixture
cleanup does not relax installer validation or change the shipped launcher.
Portable lifecycle and filesystem-denial regressions complement the native
Windows lock tests; local passes do not establish native Windows acceptance.
