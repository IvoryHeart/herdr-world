# Contributing

## Development Setup

1. Install Bun 1.4.3 or newer (CI uses 1.4.3) and start a local Herdr server.
2. From the repository root, run `bun install --frozen-lockfile`.
3. Run these in separate terminals, then open <http://localhost:5173>:

   ```bash
   bun run dev:server
   bun run dev:web
   ```

Keep `bun.lock` (the application lockfile) and shared tools (TypeScript, Bun types,
formatting/linting) at root; browser/Vite dependencies in `web/package.json`;
server runtime dependencies in `server/package.json`. After dependency changes,
run root `bun install` and commit manifests/lockfile.

The isolated development-only [Quint tooling](tools/quint/README.md) has its own
reviewed `package-lock.json`, outside application workspaces. Install it with
`bun run verification:setup`; do not add checker binaries to the application or
replace its lock with an unlocked global dependency.

## Validation

**Fresh checkout:** install dependencies, then `bun run typecheck` to build/embed
assets required by server typechecks and process tests.

| During iteration | Command / limits |
| --- | --- |
| Types | `bun run typecheck:quick` checks root scripts, web, and server without rebuilding assets or validating production bundles. |
| Lint | `bun run lint` runs Oxlint across the repository. |
| Related tests | `bun run test <path>` or `bun run test:quick` (includes integration tests and excludes the dedicated browser suite). |
| Browser regressions | `bun run test:browser` runs every Chrome-driven test and World browser suite; requires Chrome/Chromium or `CHROME_BIN`. |
| Completed candidate | Stage intended files, run `bun run format:staged` once, restage and inspect the diff. The command rejects staged files with unstaged edits; docs-only candidates are a safe no-op. |
| Branch push | The installed pre-push hook runs `bun run check:changed` for code: static checks plus the tests the change affects. A Markdown-only follow-up to a passed code gate runs `bun run check:docs`. CI runs the full gate on the PR head. |
| Full local gate | `bun run check:delivery` runs every check, in parallel lanes; `HERDR_WORLD_PREPUSH=full git push` makes the hook run it. |

Run `bun run install-hooks` once per clone to point Git at the tracked
`.githooks/` directory. Its `pre-commit` hook checks formatting and lint without
writing files, and its `pre-push` hook runs the applicable check. Use focused checks
only for a specific question while developing. For a code push, the hook runs
`bun run check:changed` against the remote branch (or `origin/main` for a new
branch). It always runs formatting, lint, type checks, the build, the site and
OpenSpec validation. It then runs the unit tests that import or read a changed
file, the World browser suites nearest to each changed file, and behavioral
verification when a change touches its models, adapters, contracts or a
`verification/coverage.json` owner. A deleted file runs the tests that still
import or name it. Toolchain, lockfile, configuration and gate changes, code that
no test, build or verification model reaches, and pushes of anything but the
worktree's HEAD (another branch, several refs) get the full gate. CI's full gate
stays the authority: the scoped gate trades local completeness for speed, so a
broad acceptance suite may first fail on CI. The hook uses `bun run check:docs`
only if its local report proves a passed code gate on an ancestor and every
change since then is ordinary Markdown documentation. Behavioral contracts,
OpenSpec, tooling and agent/contributor policy receive the code gate even when
only Markdown changes. CI runs documentation
checks for ordinary Markdown-only PR diffs, and reuses an exact-head successful full
result for PR-description edits; missing proof falls back to the full check.
The three required CI job names remain the same. `bun run check:delivery` runs
the full gate locally: static checks first (later lanes read the build), then
behavioral verification alongside unit tests and the untimed World browser
suites, then Chrome-driven tests and the wall-clock-budget suites once the CPU is
quieter. Lane logs are kept in `.agents/delivery/lanes/`. One gate runs at a time
per machine; a second waits. After a failed push check,
use the failing stage and focused checks to diagnose the issue. Do not run
`bun run format` for a scoped change. The pre-push hook records each gate's
status, elapsed seconds and gate name in the ignored
`.agents/delivery/pre-push.tsv` file. A failed gate keeps its complete log in
the same directory and prints its path.

Workspace checks: `bun run --filter herdr-world-web typecheck` and
`bun run --filter herdr-world-server typecheck` (builds/embeds web assets first).

Frontend changes: `bun run build:web`. Production assets/bundling: `bun run build`.
Releases: package and inspect every supported archive/checksum; see
[packaging](docs/packaging.md) and [release](docs/release.md).

## Behavioral evidence

Assess every changed contract against the stable [43-area inventory](verification/coverage.json).
Use existing requirements, fixtures and regressions to state allowed and forbidden
behavior before choosing evidence. Ordering, ownership, authority and recovery
normally warrant maintained Quint models connected to real implementation replay.
A direct exhaustive implementation check, browser test or platform test can be a
better alternative; record its reason, executed coverage and limits in the inventory.
Pure edits with no contract effect need only an explicit no-impact explanation.

Update affected model contracts, adapters, consumer mappings and regressions
alongside behavior. A passing model is insufficient if its intended requirement
or its mapping is wrong. Retain positive witnesses and fault controls; generic
parser, adapter, timeout and cleanup errors must fail the run.

For modeled changes, run `bun run verification:setup`, then
`bun run verification:typecheck` and `bun run verification:check`. Focused
`bun quint/run.ts --case <model>` runs help iteration but do not replace
the complete required run. The canonical command uses two isolated case workers
by default, as configured in `tools/quint/execution.json`, and requires complete
source-consistent aggregate evidence. The Behavioral verification
workflow runs all models without labels or path exclusions and is a protected
Delivery checks dependency. CI's Delivery checks run every repository check
and the full `verification:gate`, including the diagnostic control. Pre-push runs
`bun run check:changed`, which runs the full `verification:gate` (never `--case`)
when a change touches verification inputs or a contract owner, and leaves the
rest to CI; `bun run check:delivery` runs everything locally. Linux CI additionally enforces the aggregate resource envelope described
in [behavioral evidence](verification/README.md#candidate-commands-and-promotion).
Independent acceptance is recorded in [promotion decisions](verification/promotion-review.md);
Final implementation/gate/resource acceptance is recorded in [review 5517420140](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5517420140); owner-approved PR #188 merged as `481ca1e8`. Mandatory consumers and excluded claims remain binding.

For an unmodeled critical change, record and execute the proposed model or justified
alternative before review. For a mechanical change, explain why contracts and
existing evidence are unchanged; do not create a product specification or model
merely to satisfy the template. See [behavioral evidence](verification/README.md)
for finite, platform and durability boundaries and the promotion checkpoint.

## Style Organization

Global styling is split by responsibility; there is no monolithic stylesheet.

- `web/src/styles/tokens.css`: theme variables only (`:root`, `data-theme`,
  `data-accent` selectors).
- `web/src/styles/base.css`: element resets and shared primitives (`.modal`,
  `.form-field`, `.badge`, `.status-*`, `.git-*`, `.panel*`, loading states).
  Styles used by several unrelated components belong here, not in one
  component's file.
- `web/src/styles/vendor.css`: shared syntax highlighting and diff renderer
  overrides. Consumer-specific library overrides live with their components.
- `web/src/styles/layout/*.css`: app-shell regions (`app`, `topbar`,
  `sidebar`, `toast`, `mobile-nav`), imported once by `App.tsx`.
- `web/src/components/<Name>.css`: styles for one component, imported by that
  component (`import "./<Name>.css"`) and deleted together with it. The same
  pattern applies to `web/src/components/ui/` primitives.

Keep class names prefixed with the component name (for example
`.agent-history-card-title`) so selectors stay searchable and collision-free.
Media queries (including mobile adaptations) live in the owning file next to
the rules they adjust; do not create a separate mobile stylesheet.

App shell and Suspense fallback styles must load before the lazy content they
surround: use `styles/base.css` or `styles/layout/`. Styles shared across
independently loaded features belong in a shared stylesheet imported by each
consumer, or in `styles/base.css` when needed globally. A feature's components
may share co-located CSS when their explicit static imports guarantee it loads
on every rendering path; do not rely on an unrelated feature being opened.

## Keep documentation current

Every significant change must include the relevant current documentation updates
in the same PR. Use the [knowledge map](docs/knowledge-map.md) to find affected
guides: tutorial and features for changed user steps or controls, README for
first-run changes, deployment/packaging for configuration and distribution, and
architecture or contributor guidance for contracts and workflows. Update current
specifications when their contracts change; preserve historical evidence.

Name the affected docs in the PR description. If no update is needed, explain
why the existing instructions still describe the delivered behavior. Changelog
entries record changes but do not replace instructions. For tutorial/site edits,
run the checks below and verify the rendered result.

## Pages Website and Tutorial

Edit `site/` for the landing page; **only `docs/TUTORIAL.md`** for tutorial text.
`scripts/build-pages.ts` renders into `site/tutorial/index.html`, rewrites
screenshots/references, and checks built-site links/fragments.

```bash
bun run test scripts/pages-content.test.ts scripts/pages-workflow.test.ts
bun run build:site
```

The build adds content versions to local CSS and JavaScript URLs so a new page
loads its matching assets rather than a cached stylesheet from a previous deploy.

Serve `.pages-dist/` locally and check the homepage and `/tutorial/`, narrow screens, keyboard
navigation, and JavaScript-disabled reading. Production canonical URLs, social
images, and the sitemap use <https://herdr.world/>. Do not commit `.pages-dist/`.

**Deploy Pages** runs on pushes to `main` (including merged PRs); manual dispatch
remains available for retries. Both require a published Herdr World release as GitHub
Latest: the live installer probe blocks upload on missing assets, HTTP errors,
or network failures. Source builds do not qualify. After repository renames,
align the site's installer URL and workflow probe.

## Pull Requests

Use focused commits and short imperative messages. PR descriptions should cover
behavior, verification, and compatibility impact. For UI changes, upload
screenshots as GitHub attachments and embed them in the PR description. Do not
commit screenshot files to the repository solely for PR review. Do not commit
generated assets (`dist/`, `server/public/`) or binaries.
Record a user-facing change as a changelog fragment, `changes/<pr-number-or-slug>.md`,
before the first push, rather than editing `CHANGELOG.md`. See
[changes/README.md](changes/README.md) for the format; `bun run changelog:check`
validates it. CI requires a fragment from every PR that is not documentation-only.
A PR with nothing user-facing (tests, CI, contributor tooling) instead puts
`Changelog: none — <specific reason>` in its description. PR links in entries are
optional; do not push again solely to add one after the PR opens.

Unlabeled PRs get `documentation` (docs-only), `dependencies` (dependency updates),
`bug` (fix titles), or `enhancement` (other code). Release preparation gets
`skip-changelog`. Override with a `.github/release.yml` category before merging.

Contributions are licensed under MIT.
