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
| Branch push | The installed pre-push hook runs `bun run check:changed` for code: static checks plus the tests the change affects. A Markdown-only follow-up to a passed code gate runs `bun run check:docs`; a push that only merges `origin/main` runs `bun run check:static`. CI runs the full gate on the PR head. |
| Full local gate | `bun run check:delivery` runs every check, in parallel lanes; `HERDR_WORLD_PREPUSH=full git push` makes the hook run it. |
| Disk hygiene | `bun run agent:worktree -- prune` removes merged, clean agent worktrees (see [agent development](docs/agent-development.md#keep-the-disk-healthy)); heavy checks refuse to start below 3 GB free (`HERDR_WORLD_MIN_FREE_GB`). |

Run `bun run install-hooks` once per clone to point Git at the tracked
`.githooks/` directory. Its `pre-commit` hook checks formatting and lint without
writing files, and its `pre-push` hook runs the applicable check. Use focused checks
only for a specific question while developing. For a code push, the hook runs
`bun run check:changed` against the remote branch (or `origin/main` for a new
branch). It always runs notices, changelog validation, the size ratchet, formatting,
lint, type checks, the build, the site and OpenSpec validation. The size ratchet
checks the proposed merge tree against main's ceilings, so an unchanged branch
behind main passes while a restored ceiling fails. Tracked working edits and
newly staged sources are included without changing HEAD or staged contents.
Merge conflicts block the check. Fetch main to refresh the proposed merge input.
For a stacked PR, run `bun run check:size origin/main <target-ref>` or set
`HERDR_WORLD_RATCHET_TARGET=<target-ref>` for pre-push; CI supplies the exact PR
base SHA. The gate then runs the unit tests that import or read a changed
file, the World browser suites nearest to each changed file, and behavioral
verification when a change touches its models, adapters, contracts or a
`verification/coverage.json` owner. A deleted file runs the tests that still
import or name it. Toolchain, lockfile, configuration and gate changes, code that
no test, build or verification model reaches, and pushes of anything but the
worktree's HEAD (another branch, several refs) get the full gate. CI and pre-push share the complete-PR classification in
`scripts/validation-scope.ts`. Unknown paths and gate/configuration changes select
every suite. Main always runs the full matrix; its integrated result remains the
broader acceptance boundary. The hook uses `bun run check:docs`
only if its local report proves a passed code gate on an ancestor and every
change since then is ordinary Markdown documentation. Behavioral contracts,
OpenSpec, tooling and agent/contributor policy receive the code gate even when
only Markdown changes. CI runs documentation
checks for ordinary Markdown-only PR diffs, and reuses a successful full result, or a scoped result with an identical
selection, on the exact PR, base and head for description edits and label changes. These
metadata events queue behind active CI instead of cancelling it; missing proof
falls back to fresh validation for the current scope. One scope decision feeds every platform job,
and Delivery checks includes both macOS lifecycle results. See the
[pipeline ownership guide](docs/ci-pipelines.md) for the job boundaries and
failure diagnosis.

PR CI and pre-push use the same suite rules. Static checks always run for code;
ordinary Markdown uses `check:docs`. The complete PR determines applicability,
including both rename paths; a local incremental push may narrow unit consumers.
The graph retains deletions from both diffs, so adding then removing an unused
file across pushes does not widen the remaining change's scope.
A reverted gate/configuration edit in the incremental delta still selects the
full gate, even when that input is absent from the net PR diff.

| Suite | PR selection | Full/main execution |
| --- | --- | --- |
| Non-browser tests | Tests reaching changed inputs | All tests, across two CI runners |
| Behavioral verification | Model/tooling/OpenSpec inputs or model-backed coverage owners; model-free owners run the cheap coverage inventory check | All accepted models, across three CI groups balanced by measured work |
| World browser tests | Nearest consumer suites in the import graph; World runtime paths add the dense end-to-end suites (production and concurrent contexts, terminal handoff) | All six World shards |
| Web browser tests | Affected registered browser suites | All suites, across two runners |
| Native installation | Install/plugin/package inputs, server/shared binary sources, build-version metadata or affected installation consumers | Installer upgrades, Windows plugin and both macOS architectures |

The agent-tooling exception from #484 still covers `scripts/agent/**`, the named
agent/crew/dispatch runbooks and `changes/<slug>.md`: static checks and affected
unit tests, with the agent test inventory for uncovered modules. It skips heavy
suites even though the inventory's broad scripts owner would otherwise apply.
Contributor docs and skill Markdown run documentation checks or named consumer
tests. Executable workflows and gate configuration run all checks. Browser
shard-table edits retain inventory tests and every browser suite without selecting
native work or models. Model-free owners (including Q41's scripts) run affected
consumers and `scripts/verification-coverage.test.ts`; changed model mappings
still select verification. Main always runs every suite. Browser Chat changes can skip verification/platform work; server
agent changes remain contract owners.

`Delivery checks`, `Repository validation`, browser/behavioral aggregates
and the two protected macOS report names remain. macOS reports succeed without
native steps when installation is inapplicable. Aggregate checks require every
selected job to succeed and only accept skips declared by scope. Leaf job checks
report failure as soon as their job ends; `Delivery checks` waits for the aggregate.
The crew's reaction to those early failures is maintained separately. Main pushes
and explicit `check:delivery` always run everything.

CI verification groups are partial evidence. The aggregate requires every accepted
model exactly once, the current complete source inventory/revision, matching tool
identities and successful resource accounting for all three groups. Each runner
retains the 4 GiB/no-swap/two-CPU limit and its OOM/cancellation controls. The
bounded payload has a sibling supervisor in the delegated service subtree, so
even a payload-wide OOM kill preserves exit reporting and resource accounting.
The supervisor is outside the payload's memory limit and measured peak; the
service-wide CPU quota also bounds supervision. The
standalone local `verification:resources` command retains one single-machine
envelope; ordinary local canonical commands remain unchanged. The aggregate retains each runner's
accounting. Reruns select the newest artifact attempt for each group and cannot
fall back from incomplete newer evidence. The canonical local gate still accepts
no model filters.

Prepare the final PR description in a file after committing, then run:

```bash
bun run check:pr-body <file>
gh pr create --body-file <file> # include the required labels at creation
```

The local check uses the same knowledge-map and changelog functions as CI against
the committed diff from `origin/main`. For a stacked PR, append its base ref to
the check command. It validates fragment contents as well as the description.

`check:commit` names the hook's guard: it refuses staged files under `.agents/`
other than the shared skills (`check:agents`), then checks format and lint. Release workflows use
`check:source` for the guard, asset-building type check and tests; `precommit`
remains its compatibility alias. `check` delegates static validation to the same
lane used by local delivery, then runs tests. That lane checks source types and
builds production assets once, instead of building the web app during both type
checking and compilation.

A push that only merges `origin/main` into the already-pushed branch runs
`bun run check:static` (the static lane alone): both sides were tested and CI runs
the full gate on the merge. `scripts/merge-push.ts` decides this conservatively.
The push must add exactly one merge commit on top of the remote branch tip, its
second parent must be in `origin/main`, and `git merge-tree` must reproduce it
without conflicts, except a `CHANGELOG.md` conflict resolved by taking main's file.
The merge commit's tree must equal that clean merge apart from changelog
fragments. Any other conflict resolution or edit, including one that touches
code, gets the normal check.
The three required CI job names remain the same. `bun run check:delivery` runs
the full gate locally: static checks first (later lanes read the build), then
behavioral verification alongside unit tests and the World browser suites, then
the Chrome-driven tests outside World once the CPU is quieter. No suite asserts
a wall-clock budget: input delays are reported by the non-blocking World latency
trend ([development](docs/development.md)). Each fixture still exercises its own
concurrent production contexts and deadlines.
Lane logs are kept in `.agents/delivery/lanes/`.
The Web browser lane also boots the real `web/src/main.tsx` through an isolated
Vite development server, captures startup exceptions and ErrorBoundary failures,
and requires the application shell to mount. A fresh-process unit regression
loads the asks model before the application store with browser storage present.
These checks exercise entry initialization as well as the focused UI fixtures.

Heavy local checks share one machine-wide queue (`scripts/check-lock.ts`) across
all worktrees and clones: one browser lane (World browser suites, Chrome-driven
tests) and one behavioral verification at a time, and at most two light lanes
(static checks, unit tests). The delivery gate's quiet lane (Chrome-driven tests
outside World) needs the whole machine: it takes every slot, waiting for running
heavy lanes, and nothing heavy starts beside it. It reserves admission while
waiting, so later ordinary requests cannot starve it. Canonical paths, directory selectors,
filters and ambiguous options in direct test runs are queued conservatively.
Admission is reserved before heavy slots drain, so even otherwise-free light
slots wait while a whole-machine request is pending; this can take minutes.
Direct runs that may include a browser suite, including the default full run
and unknown selectors, take the browser slot.
Known value-taking flags such as `-t` and `--timeout` leave explicit file
selection intact; a flags-only invocation still selects the full run.
`bun run check:changed`, `check:delivery`,
`test:browser`, `scripts/run-world-tests.ts` and any `bun run test` that includes a
Chrome-driven suite all queue, and a waiting lane prints `waiting for <worktree>
<lane> (pid, since)`. Slots are
`flock(2)` locks under `$XDG_RUNTIME_DIR/herdr-world-checks` (or the temporary
directory), released by the kernel when their holder exits however it exits, so a
crashed gate never leaves a stale lock. A lane holds one slot, or all of them taken
in one fixed order, and its children run inside it, so gates cannot deadlock. CI
does not queue.

Test Chrome renders WebGL with SwiftShader, the software renderer that CI's pixel
and visual comparisons are calibrated against. Locally, `HERDR_WORLD_TEST_GPU=1`
switches the World browser suites to hardware ANGLE over Vulkan (with Mesa's RADV,
for example), which cuts their CPU use sharply. The Town suite went from 180–217
CPU-seconds to about 19. Each run probes the GPU once with a headless Chrome. If
WebGL is missing or software-rendered there, the run logs one line and falls back
to SwiftShader. CI always uses SwiftShader and stays authoritative: GPU output can
differ slightly, so pixel comparisons that fail only in GPU mode are advisory. After a failed push check,
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
workflow runs all models without case filtering and is a protected Delivery
checks dependency whenever the shared scope selects it. Verification inputs,
contract owners and full changes require all accepted models; the agent-tooling
exception and unrelated ordinary docs skip it. Full CI covers every repository
check, accepted model and diagnostic/resource control across its workers. Pre-push runs
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

The film at `site/film/` draws its Town with the app's own Town code:
`site/film/town-art.ts` re-exports the layout, painting and sprite functions from
`web/src/world/town/`, and the build bundles it into `film/town-art.js`, so open the
film from `.pages-dist/`, not from `site/`. Changes to Town's art reach the film on the
next site build, and the Pages workflow redeploys when Town's art changes.
`scripts/pages-film.test.ts` renders every frame in headless Chrome, with and without
reduced motion, so a Town change that breaks the film fails the gate.
`/film/` plays a video recorded from the live film; `?live` draws it in the browser,
and the page falls back to drawing it live when the video is missing (a plain
`build:site`). `bun run film:render` records the video after `bun run build:site`: it
plays the film frame by frame in headless Chrome, renders the score offline and
encodes `film/media/herdr-world-film.webm` (VP9/Opus, 1080p), `.mp4` (H.264/AAC, 720p)
and `.vtt` captions with ffmpeg, about 7 MiB in all. The video is a generated output,
so it is never committed: the Pages workflow renders it on every deploy. Use
`--keep <dir>` to reuse a capture while tuning encoder settings, and `--update-poster`
to regenerate `site/assets/herdr-world-film-poster.jpg`, the video poster and social
card. `film/?t=<seconds>` opens the live film at a frame, and `?render` drops the page
chrome for 1920×1080 captures.

`YOUTUBE_ID` in `site/film/index.html` is empty. If the owner uploads the film, setting
it replaces the video with a click-to-load YouTube facade: no request reaches
`youtube-nocookie.com` until the viewer clicks, and the page's Content Security Policy
allows only that frame origin.

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

After a merge, CI runs the full check again on main. Merges that land while a
main check is running are checked together, once, at the newest of them. If a
check fails, the Main gate workflow opens one `main-red` issue. It names the
merge commit and its PR and prepares a revert PR, which it never merges; when the
check covered several merges, it lists them all and prepares no revert. Nothing
is rerun automatically: a failing test is fixed at its cause, not retried. Merge
the revert, revert the merge that broke it, or land a fix; rerun only after a
GitHub service failure. Later red commits are added to the open issue, not to new ones, and the next
green main run at or after the red commit closes the issue and its revert PR.

The **Web asset headroom** status on a PR projects its web asset delta onto
current main and fails if together they would exceed the bundle budgets in
`scripts/check-web-assets.mjs`; it warns above 95 %. Every push to main re-judges
open PRs, so a PR that fit an older main turns red once main has grown. Trim, or
raise the budget in a reviewed change, before merging.

Source files may not regrow. `bun run check:size` (part of `check` and the
static lane) allows at most 1000 lines per non-test source file; larger files are
listed in `scripts/file-size-exceptions.json` and may not grow past their recorded
size. The list only shrinks: no new or raised entries. When a split shrinks a file,
lower or remove its entry in the same PR; a split that ends an unratcheted entry
records the file's post-split size as its limit. A split PR should only move code.
`bun run check:move` is a move inventory: it fails on any removed line that does
not reappear in another file, any added line that was not removed, code moved
within its own file and blocks that change order; it prints every moved run with
its source and destination lines. Attach its output. Reviewers still read the
runs and the import/export lines it ignores; it is not a proof of no behaviour
change. Histogram diff alignment keeps retained core bodies out of the inventory.
At least three consecutive matching lines establish each cross-file mapping.
Shorter fragments may join it only at a unique remaining location that preserves
the source and destination order around all accepted runs. Each added line is
consumed once; short fragments are printed explicitly as anchored fragments.
Unanchored short swaps, ambiguous matches and same-file moves remain failures.
Static JavaScript/TypeScript imports with bindings and export lists use parsed statement
bounds, including multi-line lists. Dynamic imports and executable code sharing
an import/export line remain in the inventory, as do side-effect-only imports.
Unparseable files keep all lines. The CLI prints ignored import/export changes
per file (up to 40 lines each), so attached output includes the wiring to review.

Unlabeled PRs get `documentation` (docs-only), `dependencies` (dependency updates),
`bug` (fix titles), or `enhancement` (other code). Release preparation gets
`skip-changelog`. Override with a `.github/release.yml` category before merging.

Contributions are licensed under MIT.
