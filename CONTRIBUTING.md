# Contributing

## Development Setup

1. Install Bun 1.4.4 or newer (CI uses 1.4.4) and start a local Herdr TUI or herdr-core runtime.
   Both runtimes are external; see [runtime setup](README.md#runtimes).
2. From the repository root, run `bun install --frozen-lockfile`.
3. Run these in separate terminals, then open <http://localhost:5173>:

   ```bash
   bun run dev:server
   bun run dev:web
   ```

For a worktree preview, use the [isolated preview recipe](docs/development.md#isolated-worktree-preview).

Keep `bun.lock` (the application lockfile) and shared tools (TypeScript, Bun types,
formatting/linting) at root; browser/Vite dependencies in `web/package.json`;
server runtime dependencies in `server/package.json`. After dependency changes,
run root `bun install` and commit manifests/lockfile.

The isolated development-only [Quint tooling](tools/quint/README.md) has its own
reviewed `package-lock.json`, outside application workspaces. Install it with
`bun run verification:setup`; do not add checker binaries to the application or
replace its lock with an unlocked global dependency.

Dependabot groups updates for all manifests: the root/web/server Bun workspace
and lock, isolated Quint npm manifest and lock, and Actions. Security updates
remain enabled independently of weekly version updates. Maintainers own alerts;
shipped high/critical findings must be fixed or excepted before the next release,
and development-only alerts within a week. Run `bun run security:check` after a
dependency change; see [SECURITY.md](SECURITY.md#dependency-alerts-and-ownership)
for the shipping boundary, response policy and exact expiring exception format.
`bun run security:check --demo-vulnerable` demonstrates an advisory failure using
synthetic input, without editing files or installing vulnerable code.

Same-repository Dependabot PRs receive automatic maintenance from trusted base
policy: refreshed notices, a fix PR title when the shipped graph changes,
or a specific `Changelog: none` reason for development/Actions-only updates, plus
PR-body documentation metadata and reasoned `Spec impact:` / `Verification impact:`
lines for routine version updates. Notice generation follows workspace dependency
paths, including development, optional and peer dependencies, but stops at
OS/CPU-specific packages. Their exclusive transitive dependencies are excluded;
packages also reachable through a portable path remain required. Every expected
portable package must still be installed at its locked version, or preparation
fails. The preparation job runs with a read-only token,
disables dependency lifecycle scripts and never executes candidate scripts. A
separate write job checks out only trusted policy, validates the allowed output
paths and current head, commits generated docs to the bot branch, then explicitly
dispatches CI because token-created commits do not start workflows automatically.
Human PR policies, independent review and protection remain required. If a bot
update changes tool semantics or models, take ownership of its failing gate;
automation does not weaken verification or approve/merge a PR.

Behavioral verification CI uses Node 24.19.0 and Eclipse Temurin JDK
21.0.13+9 (Linux x64). The shards and aggregate install that exact Java build
through a commit-pinned `actions/setup-java`, reusing its runner tool cache when
available. They do not select the runner image's preinstalled Java. Use the same
build locally to reproduce CI tool identities; aggregation rejects differing
tool identities, including Java patch versions.

## Validation

**Fresh checkout:** install dependencies, then `bun run typecheck` to build/embed
assets required by server typechecks and process tests.

| During iteration | Command / limits |
| --- | --- |
| Types | `bun run typecheck:quick` checks the same three projects as `typecheck` (root scripts, web, server). It saves the asset rebuild, not a smaller typecheck; use after assets exist. |
| Lint | `bun run lint` runs Oxlint across the repository. |
| Related tests | `bun run test <path>`; `test:quick` omits only the filename patterns listed below and can still launch Chrome. |
| Browser regressions | `bun run test:browser` runs every Chrome-driven test and World browser suite; requires Chrome/Chromium or `CHROME_BIN`. |
| Completed candidate | Follow the [candidate-delivery procedure](.agents/skills/candidate-delivery/SKILL.md). |
| Branch or tag push | Pre-push runs read-only formatting and privacy only. Static/unit/browser/behavioral checks run in CI; Delivery checks is the single required aggregate. |
| Full local gate | `bun run check:delivery` explicitly runs all local lanes. Native acceptance and enforced CI resource accounting remain separate. |
| CI and delivery numbers | `bun run ci:health --days 3` reads GitHub without writing files; see [definitions and limits](docs/ci-pipelines.md#health-and-delivery-measures). |
| Disk hygiene | `bun run agent:worktree -- prune` removes merged, clean agent worktrees (see [agent development](docs/agent-development.md#keep-the-disk-healthy)); manage disk capacity separately; it never blocks a check. |

`test:quick` excludes only `{uiScale,mobileTerminal,filePreviewNavigation,TerminalThemeDialog,VisualPreview,ThemedSelect,ThemedSelect.browser,HerdrSetupCard}.test.ts`; it includes other browser and integration tests.
All required PR checks run on Linux, including native input changes. Main reports existing PR evidence without heavy checks. Release tags build/test/seal native bytes; nightly native checks remain advisory.

Tests sit beside their source. `bun scripts/affected.ts origin/main` lists branch impact.

Tests launched with `bun run test`, the local gates and CI receive a fresh
HOME, XDG config/cache/data/state/runtime directories and World data directory
**before Bun starts**, including its cached `os.homedir()`. PATH contains system
tools and the selected Bun/Node/Chrome executables, without user bin directories
or installed `herdr`, `herdr-core`, `hc` or `herdr-world`. Runtime variables,
SSH credentials/config redirects, harness homes, tokens and proxies are removed;
only the runner's queue/assets/label markers and browser-diagnostics settings
survive. Direct `bun test` refuses
with the wrapper command to use. Fixtures must inject every runtime dependency,
including detection, and create their own synthetic configuration.
Scratch executable checks resolve both the fixture and scratch-root identities,
including macOS temporary-directory aliases; links to host executables stay refused.

The test tripwire refuses real runtime/service commands, core/World installers,
SSH connections, downloads and non-loopback network requests. Loopback fixtures
use dynamically assigned ports; 8787/8788 and sockets outside test scratch are
refused, except short sockets actually bound by a test fixture. The runner fails even if application code catches the error. Shell
children inherit guarded service/download/SSH commands; source Bun children
inherit the preload. Installer fixtures need fake commands in their scratch PATH
and an explicit scratch HOME. This is an accidental-side-effect guard, not a
security sandbox for hostile code.

Live suites opt out explicitly with `bun run test --live <file.live.test.ts>`;
name only live files, never a directory or the ordinary inventory. They still
get scratch HOME/config/cache/data/state and retain their existing fixture
lifecycle/cleanup. They bypass process/network and shell-command guards; a supplied
`XDG_RUNTIME_DIR` is retained so live resource controls can reach the user manager.
Supply their documented live binary/fixture variables explicitly. The separate
`bun scripts/herdr-core-smoke.ts` release smoke downloads a verified binary and
uses this live route; ordinary tests cannot inherit its opt-out or binary.
The resource-verification gate also invokes named live controls through this
wrapper. Only live runs retain its `HERDR_RESOURCE_MANAGER=user|system` selection;
ordinary runs drop it so an inherited setting cannot enable real-cgroup tests.

`bun run lint` also checks test portability: never rename a coreutils executable
(e.g. symlink `sleep` as a fake harness/process name). GNU tools may accept this
while uutils on CI refuses it with “Security violation”. Keep the basename, use
`sh -c 'read line'` for an idle named process, or build a purpose-specific probe.
This cheap rule runs locally and in CI, without a container/tool download on each
push. Native platform lanes remain responsible for their OS-specific behavior.

Run `bun run install-hooks` once per clone to point Git at the tracked
`.githooks/` directory. Its `pre-commit` hook checks formatting and lint without
writing files. Its `pre-push` hook checks read-only formatting and scans every
pushed ref for privacy. Description, changelog, source coverage, size, dead-code,
unit and behavioral policies run in CI. Before handoff, validate the exact PR body
with `bun run check:pr-body <file> <base-ref>`. Non-documentation PRs retain the two
impact lines and independent review; neither policy runs inside pre-push.

### Privacy before publication

Run `bun run check:privacy` after committing and before every push, especially
when copying anything out of `.agents/` into tracked paths. The command scans
each commit introduced since `origin/main`; `bun run check:privacy --range
<base-ref> <head-ref>` selects another range. The pre-push hook scans every actual
pushed ref, including tags and multiple refs. Before pushing, save the intended
description and set `HERDR_WORLD_PR_BODY=<file>`; the same privacy step scans that
file, or the existing PR description when no file is supplied, and the existing PR
title. The independent **Privacy guard** CI check runs once per PR change,
including title/description edits, which it scans from the event payload;
explicit bot dispatches cover token-created PRs. It no longer duplicates every
branch push. `bun run check:pr-body <file>` also checks description privacy,
including hidden Markdown comments and code blocks.

The guard checks full messages and added lines in every introduced commit, so
deleting a leak in a later commit of the same push does not hide it. It rejects
Claude code session links, session trailers, Claude Code generation footers and
Claude coauthor trailers alongside private/CGNAT IPv4,
Tailscale IPv6 and `*.ts.net` hosts, absolute home paths, plausible login tokens
and session secrets, literal World passwords, and non-reserved email addresses.
It prints only the location, line and rule, with a commit SHA for commit findings;
matched values and Git error details are suppressed. Email attribution exceptions
for generated dependency licenses never apply to messages or PR metadata.
Commit and PR metadata allow GitHub's public support identity and email addresses
on the exact `users.noreply.github.com` domain, so bot signoffs and human coauthors
pass. This exception permits only those email values; all other privacy rules
still apply, including Claude coauthor detection. Added file content retains its
existing email policy.
A missing or rewritten previous push head falls back to `origin/main`
(or all history if main is unavailable); an unavailable requested head fails.
Branch pushes exclude published main history. Merge commits scan lines absent
from every parent, so syncing main does not reattribute published content.
Renames scan their added content; binary blobs, existing unchanged lines and
deletions are outside the text scan.

Use RFC 5737/3849 documentation addresses and reserved domains such as
`example.com` and `.invalid` for fixtures. The small value-level allowlist in
`scripts/privacy-allowlist.ts` permits explicit placeholders, repeated-character
credentials and synthetic home usernames; changing it requires review. There
is one narrow attribution rule: `DEPENDENCY_LICENSES.md` may reuse exact public
email addresses already published in that file on `origin/main` before the push, preserving
upstream licence attribution across dependency refreshes. New addresses require
a reviewed allowlist change. The owner-approved Knip copyright exception in that
allowlist permits one exact upstream address only in `DEPENDENCY_LICENSES.md`.
All other privacy rules still apply there, and the same emails remain disallowed
elsewhere. Package versions such as
`react-dom@19.3.1.patch` are not emails. There are no whole-file exclusions or
inline bypasses. Keep credentials, runtime state,
`*.local.md` notes and owner-only material in gitignored paths; `research-local/`
is the owner-only research folder. Ignore rules do not remove already tracked files.

CI detects a publication violation after a push; it cannot undo disclosure. If
the guard flags committed private data, remove it from the unpublished commits
before pushing and rotate any exposed credential through the owner.

### PR impact assessment

Use two plain lines without bold labels in every non-documentation PR:

```text
Spec impact: <updated spec path or OpenSpec change name, or none — reason>
Verification impact: <updated model, adapter, coverage owner or named check path, or none — reason>
```

Good examples:

```text
Spec impact: none — Contributor tooling leaves product contracts unchanged.
Verification impact: scripts/check-pr-body.test.ts — Policy input and diff regression cases.
```

Bad examples (each lacks a reason):

```text
Spec impact: none
Verification impact: none
```

`bun run check:pr-body <file>` checks the committed PR diff, as CI does.
Spec claims name a changed path, spec directory, complete capability ID (including
nested IDs such as `world-surfaces/town`) or OpenSpec change name. Verification
claims name a changed model, adapter, coverage owner or test/check path. An untouched
claim fails. `Spec impact: none` fails when `openspec/specs/` or `openspec/changes/`
changes; `Verification impact: none` fails when `quint/`, `verification/` or an owner
in `verification/coverage/` changes (including files under directory owners).
These are cheap consistency checks: reviewers still judge whether a `none` is true
and whether the evidence is sufficient. Ordinary documentation retains its exemption;
dependency-bot PRs and merge-only pushes retain their existing policy paths.

For OpenSpec work, use the adapted `world-openspec-*` skills in the
[agent guide](docs/agent-development.md#openspec-skills). CLI-generated `openspec-*`
skills do not carry this repository's authorization and delivery guidance.

Use focused checks
only for a specific question while developing.
`bun run check:changed` explicitly runs static checks and affected non-browser
units against a base. It is available during local development, separate from the
format/privacy push hook. CI owns browser, behavioral and native acceptance.
For stacked PRs, pass the actual target as the base to `check:pr-body` and
`check:size`; CI supplies its immutable base SHA. An unrelated file shrinking
only reports size slack; it is not a reason to block publication. Use
`check:dead --prune` explicitly to retire resolved allowances.

Main reuses a passing full or scoped PR result only for an identical tested tree;
otherwise it keeps a red metadata result without starting another suite. Native
installation, plugin and service acceptance runs on tags and nightly only.
The tag builds/tests/seals each channel; nightly upgrades are an advisory signal.
See the [pipeline guide](docs/ci-pipelines.md) for scope, recovery and measurements.

Lane logs are cleared at the start of each run, including skipped lanes.
See the [local queue](#local-check-queue) for shared slot ownership.

PR CI and explicit local affected checks share unit selection; CI also selects browser and
behavioral suites on Linux. Static checks always run for code;
ordinary Markdown uses `check:docs`. The complete PR determines applicability,
including both rename paths; a local incremental push may narrow unit consumers.
The graph retains deletions from both diffs, so adding then removing an unused
file across pushes does not widen the remaining change's scope.
A reverted gate/configuration edit in the incremental delta still selects the
full unit inventory locally and full CI gate, even when that input is absent from the net PR diff.

| Suite | PR selection | Full execution |
| --- | --- | --- |
| Non-browser tests | Tests reaching changed inputs | All tests, across two CI runners |
| Behavioral verification | Model/tooling/OpenSpec inputs or model-backed coverage owners; model-free owners run the cheap coverage inventory check | All accepted models, across three CI groups balanced by measured work |
| World browser tests | Nearest consumer suites in the import graph; World runtime paths add the dense end-to-end suites (production and concurrent contexts, terminal handoff) | All six World shards |
| Web browser tests | Affected registered browser suites | All suites, across two runners |
| Native installation | None; PRs run Linux checks | Tags and advisory nightly |
| Release walk | None; runs with release acceptance | Exact tagged/nightly package, real TUI/core and signed-out Claude/Codex on Linux/macOS |

Published-release bugs add or extend a release-walk journey in the same PR as the
fix. See the [release walk and escape rule](docs/release.md#real-runtime-release-walk),
which uses signed-out real harnesses and requires no manual receipt.

The production boot journey is selected for web source changes even across Vite's
build boundary. It loads release-built assets with an older browser profile and
checks background/resume, reload offers and real worker activation. Protocol
vectors retain sanitized runtime/harness evidence. The real agent-start/release
walk is maintained by #1023; release-channel staging is a separate #1044 change.

The agent-tooling exception from #484 still covers `scripts/agent/**` (the worktree
helper) and the agent development guide: static checks and affected
unit tests, with the agent test inventory for uncovered modules. It skips heavy
suites even though the inventory's broad scripts owner would otherwise apply.
Contributor docs and skill Markdown run documentation checks or named consumer
tests. Executable workflows and gate configuration run all checks. Browser
shard-table edits retain inventory tests and every browser suite without selecting
native work or models. Model-free owners (including Q41's scripts) run affected
consumers and `scripts/verification-coverage.test.ts`; changed model mappings
still select verification. Main reuses identical tested trees and otherwise runs Linux suites. Browser Chat changes can skip verification/platform work; server
agent changes remain contract owners.

`Delivery checks` is the single required aggregate. Every selected dependency
must succeed; only declared skips are accepted. The native matrix includes real
launchd checks, without extra shim jobs. Explicit `check:delivery` runs every
local lane; platform acceptance and enforced CI accounting remain separate.

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

Use the [candidate-delivery skill](.agents/skills/candidate-delivery/SKILL.md) for
formatting, commits, pushing and the exact PR-body validation/creation procedure.
Release-please creates release notes from squash-merged `fix:` and `feat:` PR titles.

`check:commit` names the hook's guard: it refuses staged files under `.agents/`
other than the shared skills (`check:agents`), then checks format and lint. `check:source` is an explicit local guard/type/test command; `precommit`
remains its compatibility alias. `check` delegates static validation to the same
lane used by local delivery, then runs tests. That lane checks source types and
builds production assets once, instead of building the web app during both type
checking and compilation.

The protected CI job names remain unchanged. `bun run check:delivery` runs all
local lanes: static checks first (later lanes read the build), then behavioral
verification alongside units and World browser suites, followed by the other
Chrome-driven tests in the same browser slot. It does not replace native platform
acceptance or CI resource accounting. No suite asserts
a wall-clock budget: input delays are reported by the non-blocking World latency
trend ([development](docs/development.md)). Each fixture still exercises its own
concurrent production contexts and deadlines.
Lane logs are kept in `.agents/delivery/lanes/`.
The Web browser lane also boots the real `web/src/main.tsx` through an isolated
Vite development server, captures startup exceptions and ErrorBoundary failures,
and requires the application shell to mount. A fresh-process unit regression
loads the asks model before the application store with browser storage present.
These checks exercise entry initialization as well as the focused UI fixtures.

### Local check queue

Heavy checks share one machine-wide queue (`scripts/check-lock.ts`) across all
worktrees and clones: one browser slot for World and other Chrome tests, one
behavioral verification slot, and two unit slots. Static checks bypass the queue;
no delivery lane takes the whole machine. Direct runs with browser files, directory
selectors, filters or ambiguous options take the browser slot conservatively.
Known value-taking flags such as `-t` and `--timeout` preserve explicit file
selection; a flags-only invocation still selects the full run.

`check:changed`, `check:delivery`, `test:browser`, `scripts/run-world-tests.ts` and
`bun run test` all use the appropriate slots. Waiting work prints its holder and
lane; wait for completion. Slots are kernel-released `flock(2)` locks under
`$XDG_RUNTIME_DIR/herdr-world-checks` (or the temporary directory), so crashes do
not leave stale locks. Children run inside their parent's slot. The exclusive
API remains available for callers requiring every slot, with admission reserved
before slots drain; ordinary delivery never uses it. CI does not queue.

Test Chrome renders WebGL with SwiftShader, the software renderer that CI's pixel
and visual comparisons are calibrated against. Locally, `HERDR_WORLD_TEST_GPU=1`
switches the World browser suites to hardware ANGLE over Vulkan (with Mesa's RADV,
for example), which cuts their CPU use sharply. The Town suite went from 180–217
CPU-seconds to about 19. Each run probes the GPU once with a headless Chrome. If
WebGL is missing or software-rendered there, the run logs one line and falls back
to SwiftShader. CI always uses SwiftShader and stays authoritative: GPU output can
differ slightly, so pixel comparisons that fail only in GPU mode are advisory. After a failed push check,
use the failing stage and focused checks to diagnose the issue. Do not run
`bun run format` for a scoped change. The cheap pre-push hook records its
format/privacy status and elapsed seconds in `.agents/delivery/pre-push.tsv`.

Workspace checks: `bun run --filter herdr-world-web typecheck` and
`bun run --filter herdr-world-server typecheck` (builds/embeds web assets first).

Frontend changes: `bun run build:web`. Production assets/bundling: `bun run build`.
Releases: package and inspect every supported archive/checksum; see
[packaging](docs/packaging.md) and [release](docs/release.md).

## Behavioral evidence

Assess every changed contract against the [coverage inventory](verification/coverage/).
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
`bun run check:changed` for static checks and affected non-browser units;
browser suites and behavioral acceptance run in CI. `bun run check:delivery`
runs all local lanes, including the full `verification:gate` (never `--case`). Linux CI additionally enforces the aggregate resource envelope described
in [behavioral evidence](verification/README.md#candidate-commands-and-promotion).
Independent acceptance is recorded in [promotion decisions](verification/promotion-review.md);
The [verification guide](verification/README.md) retains final gate/resource
acceptance, mandatory consumers and excluded claims.

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

Do not hang `:has()` on the page or World shell (`body`, `html`, `:root`,
`.app`, `.world-foundation-shell`, `.world-view-layout`): Chrome then restyles
most of the page on each typed key or streamed line. Set the state as an
`<html>` attribute from JavaScript instead (as
`web/src/terminalInputFocus.ts` does). `bun run lint` refuses new ones
([check](scripts/check-has-selectors.ts)), and
`web/src/world/ComposerTypingStyle.browser.test.ts` traces how many elements
each composer key restyles.

App shell and Suspense fallback styles must load before the lazy content they
surround: use `styles/base.css` or `styles/layout/`. Styles shared across
independently loaded features belong in a shared stylesheet imported by each
consumer, or in `styles/base.css` when needed globally. A feature's components
may share co-located CSS when their explicit static imports guarantee it loads
on every rendering path; do not rely on an unrelated feature being opened.

## Keep documentation current

Every significant change must include the relevant current documentation updates
in the same PR. Use [capability lookup](docs/agent-development.md#find-a-feature) to find affected
capability notes for changed controls and their detail (edge cases, limits,
refusals), the tutorial only when a learner's steps change, README for first-run
changes, deployment/packaging for configuration and distribution, and
architecture or contributor guidance for contracts and workflows. Update current
OpenSpec change-folder deltas when contracts change; current specs synchronize
in the reviewed post-main archive PR. Preserve historical evidence.

Name the affected docs in the PR description. If no update is needed, explain
why the existing instructions still describe the delivered behavior. Changelog
entries record changes but do not replace instructions. For tutorial/site edits,
run the checks below and verify the rendered result.

## Pages Website and Tutorial

Edit `site/` for the landing page; **only `docs/TUTORIAL.md`** for tutorial text.
`scripts/build-pages.ts` uses `site/tutorial/index.html` as the template and
renders to `.pages-dist/tutorial/index.html`, rewrites screenshots/references,
and checks built-site links/fragments. `check:docs` also checks repository-local
paths and Markdown fragments in capability notes with
`bun scripts/check-knowledge-map-links.ts`; remote URLs are not fetched.

The tutorial is for someone learning World: numbered steps that say what to do
and what they will see, ending with a "You are done when" check. It is not the
reference. Detail a learner does not need (exceptions, refusals, staleness
rules, limits, internals) goes in capability `notes.md`, and the tutorial links there.
The build fails when one step (counting all its paragraphs and sub-items) or
paragraph passes 60 words, or the tutorial passes 6,000 words of prose
(`tutorialLimits` in `scripts/pages-content.ts`): move detail to capability notes
rather than raising a limit.

```bash
bun run test scripts/pages-content.test.ts scripts/pages-workflow.test.ts
bun run build:site
```

### Help that ships with a feature

A user-facing feature declares its help beside its code, in a `<area>.help.ts`
file (`web/src/world/town/town.help.ts`, `web/src/world/board/board.help.ts`,
`web/src/components/chat/chat.help.ts`, `web/src/world/world.help.ts`) listed in
`web/src/help/entries.ts`. An entry (`web/src/help/helpEntry.ts`) says what the
feature is, up to five steps to try it, where it lives, the control it points
at and the version it arrived in. Mark that control in the component with
`data-help="<control>"` or `{...helpAnchor("<control>")}`; a control inside a
closed menu is found through the button that opens it,
`data-help-opens="<control> …"`. World's **What can I do here?** panel, the Town
Master's **What's new**, `docs/HELP.md` and the site's `/help/` page are all
drawn from these entries. The tutorial stays the short learner's path and
links the help page.

```bash
CHROME_BIN=/path/to/chrome HELP_PICTURES_IDS="town.zoom" bun run help:pictures
bun run help:docs                                  # docs/HELP.md
bun run help:check                                 # check:docs and the static lane
```

Feature PRs do not regenerate or commit Help pictures unless they add or
change a help entry. Capture only those entries with `HELP_PICTURES_IDS` (and
commit only their pictures and manifest records); update `docs/HELP.md` when
its declarations change. Remove pictures and manifest records for deleted entries.
Nobody edits a picture by hand.

`help:pictures` captures the production components on the synthetic site scene
(`web/src/help/testing/HelpShots.browser.tsx`), at phone and desktop sizes in both
themes, recording input fingerprints in `web/src/help/pictures.json`.
`help:check`, in the static/documentation lanes, checks declarations, marked controls, missing
pictures, orphan pictures/manifest records, and the generated help page. Stale
fingerprints warn without failing: a Town component change needs no picture commit.
`help:check --strict` also fails for stale fingerprints.

The broken automatic Help refresh bot was removed. Capture only changed help
entries through the commands above; retain fingerprint warnings for unrelated
Town component changes.

A PR whose changelog fragment has `### Added` changes a `*.help.ts` file or
states `Help: none — <reason>`.

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

`YOUTUBE_ID` in `site/film/index.html` is empty. After uploading the film, setting
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
Use `fix:` or `feat:` PR titles for user-facing changes and squash merge them.
Release-please keeps one reviewed release PR current, updating `herdr-plugin.toml`,
its simple-strategy version metadata and `CHANGELOG.md`; do not add fragments or
edit the changelog by hand. Tag the merged release before the next release-please
run. See [the three owner release steps](docs/release.md#three-owner-steps).

Main checks existing immutable PR evidence without running heavy checks. Missing
or failed evidence stays visible in one main-red issue; no automatic revert PR
is created. A later green result closes the issue. PR test jobs retry a failed
test step once in the same job, preserving a second failure. Native platform and
running-service upgrade checks run on tags and nightly, with nightly failures
reported in one advisory issue.


The **Web asset headroom** status on a PR projects its web asset delta onto
current main and fails if together they would exceed the bundle budgets in
`scripts/web-asset-budget.json` (`bytes`, `files` and a short reason `history`);
it warns above 95 %. Every push to main re-judges
open PRs, so a PR that fit an older main turns red once main has grown. A
stacked PR that merged newer main than its base branch has is measured against
that base with the same main merged in, so main's growth is not counted twice.
Main's status and workflow summary show the remaining bytes and files after
each merge. The main measurement carries its reviewed budget, so a budget-only
merge also updates existing PR verdicts. A failure prints the exact minimum
raise needed. Trim the feature or request a separate owner-approved PR changing
only the budget data and its reason history before merging; feature PRs must
not edit the budget or `scripts/check-web-assets.mjs`. Lowering the budget needs
no raise approval. Per-file, help-picture and startup limits stay unchanged.
The startup limits count what opening `/town` loads: the entry, the World app
chunk and the Town view, each JavaScript file once. The same check fails when
the startup load includes xterm, when unused Shiki or Pierre themes or Shiki's
JavaScript regex engine are shipped, or when a common grammar (JavaScript, CSS,
Markdown, shell, SQL, C, Java) loses its own chunk. To see what a build ships,
`bun scripts/web-bundle-report.ts` builds into a temporary folder and prints the
largest files, packages, app folders and views; it writes nothing to the tree.

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
