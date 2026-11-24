# CI pipeline ownership

CI makes one validation-scope decision and passes it to repository validation,
World browser tests, behavioral verification and native installer/platform checks. Delivery checks aggregates their results, including both macOS
lifecycle architectures. The two macOS job names remain separate required checks
for compatibility with branch rules.

| Entry point | Responsibility | Deliberate boundary |
| --- | --- | --- |
| Local pre-commit | `check:commit`: no live `.agents/` files, read-only formatting and lint | Quick feedback before a commit; not a delivery gate |
| Local pre-push | `check:changed`: static checks and affected non-browser units; gate/configuration changes run all non-browser units | Affected tests save local work; CI remains authoritative |
| Privacy on every branch push and PR | Scan added lines in every introduced commit for private material, with redacted diagnostics | Independent of PR creation and validation scope; local pre-push scans the actual pushed refs too |
| CI on a PR | Validate the proposed merge; check its description and changelog policy | One shared scope decision; native platforms and browser shards keep separate runners |
| CI on main | Execute the complete integrated matrix, without model-result or installer-build reuse | PR success cannot prove the result of later merges |
| Main gate | Classify failed push CI, rerun a recognized infrastructure failure once, or prepare an issue and revert | Does not merge a revert; green main resolves earlier alerts |
| Web asset headroom | Compare PR asset deltas with current main and re-evaluate open PRs after merges | Catches concurrent budget consumption beyond one PR's tested base |
| Town golden images | Compare five synthetic Town screenshots on manual dispatch while automatic reporting is quarantined | Advisory, separate from Delivery checks; exact pixels with pinned Chrome, fonts, clock and SwiftShader |
| Prepare Release | Generate and validate release files in a checkout, then open a PR and dispatch CI | Generated files need validation before review |
| Publish Release and Release | Authorize exact Linux/macOS release-walk bytes and signed-in local evidence before the maintainer tags; publish the same tested Unix packages | Publication requires the retained pre-tag authorization; tag protection remains in force |
| Deploy Pages | Build and publish the documentation site and film | Site publication is separate from application release acceptance |
| Upstream automation | Detect a frozen source release, request local integration and independently review it | External runtime adoption remains a separate decision |

## Check commands

| Command | Coverage and definition |
| --- | --- |
| `check:commit` | Staged `.agents/` files other than the shared skills (`check:agents`), formatting and lint; shared by the Git hook, source checks and static lane |
| `check:source` | Commit guard, asset-building type check and tests; release preparation and tag validation |
| `precommit` | Compatibility alias for `check:source`; not the Git pre-commit hook |
| `check:static` | Notices, fragments, size, commit guard, all three source type checks, Bun type checks, production build, site and specs; defined once in `scripts/check-delivery.ts` |
| `check` | Static lane followed by tests; CI separates browsers through its existing environment selection |
| `check:changed` | Unqueued static lane plus affected non-browser units; browsers and verification run in CI |
| `check:delivery` | Static lane plus all test lanes and behavioral verification |
| `check:pr-body <file>` | CI capability source-coverage and changelog policy against a committed PR diff and draft description; optional base ref follows the file |
| `check:privacy` | Committed additions since `origin/main`, or `--range <base-ref> <head-ref>`; [privacy policy and reviewed exceptions](../CONTRIBUTING.md#privacy-before-publication) |
| `check:docs` | Notices, fragments, formatting, site and specs for qualifying Markdown changes |
| `test:install-linux` | Real Linux x64 installer, runtime downloads, systemd user unit/reboot, RPC setup and stable upgrade in disposable Docker containers; [runbook](development.md#linux-installation-acceptance) |

The static lane uses `typecheck:quick` because its production build follows.
It retains all three TypeScript projects and production asset checks while
avoiding the second web build previously triggered by server's `pretypecheck`.
Standalone `typecheck` and release source checks retain that asset-building hook.
`scripts/gate-commands.test.ts` executes the entry points with stubbed leaf
commands to verify coverage, ordering and failure propagation without rebuilding.

## Scope and scheduling

Code events (`opened`, `synchronize`, `reopened`) receive fresh validation, and
so does an `edited` event that changes the base branch: it is a new merge.
Title or description edits and labels queue behind a running check instead of cancelling
it. They may reuse a successful full Delivery checks job, or a scoped job with the
identical selection, for the same PR, base commit and head commit. A title or
description edit tries this before any other choice, so it also reuses a
documentation, tooling or `world-browser-stability` result with the identical
selection; it then runs only Validation scope (with the description check),
Delivery checks and the two macOS report names. The dependency audit is skipped
with the other leaf jobs, because the reused Delivery result already required it. GitHub's historical PR association can change, so
it is not proof of the tested base. Reuse binds the selected Delivery job
to its run and attempt, reads the full checkout SHA only from that job's checkout
action log, and resolves the immutable merge commit. Its returned SHA must match
the checkout SHA and its two ordered parents must match the requested base/head.
Scoped jobs publish one `[delivery-proof]` record only after all applicable
results pass. Reuse compares every selection field, including ordered test arrays
(the order determines shards), and requires the scoped acceptance step to pass.
A reused result is never fresh evidence. Default leaf checkouts retain the
original event's `GITHUB_SHA`. A newer failed or cancelled candidate prevents
reuse of an older success, even when its Delivery job was never created. The
one exception is a run whose Validation scope job failed at the description
check before choosing a scope: it tested no code, so correcting the description
still reuses the older result. A
matching workflow must have succeeded before its job proof is considered;
unfinished or other unsuccessful runs also fail closed. Missing, ambiguous or
expired logs and API errors
fall back to fresh validation for the current scope.
The release-preview label can therefore request archives without repeating a
successful applicable check. Other label changes still create workflow runs, but can
take this same short path. A title or description edit rebuilds no preview
archives; a new commit, a base change or a label does.

A closed or merged PR starts no CI work. GitHub still creates a run for its
edit or label, but Validation scope requires an open PR and every other job
depends on it, so all jobs are skipped before they wait for a runner. Label
Pull Requests likewise skips closed PRs, and skips description-only edits
because the release-note category reads only the title, author and changed files.

Before any bulk edit of PRs or issues (for example rewriting many descriptions),
check the `on:` triggers in `.github/workflows/`: every workflow that listens to
`edited` creates a run per edited item. On 2026-11-24 an edit of about 340 PR
descriptions created about 650 runs that held the runners for three hours.

Ordinary Markdown-only diffs receive documentation checks. Verification inputs or
model-backed contract owners still require behavioral verification, even when
their edits are Markdown. Contributor instructions and skill Markdown receive
documentation checks or their named consumer tests. Packaged notices, OpenSpec,
verification and executable workflow policy do not qualify for this shortcut. macOS jobs
still report both protected architecture names on Ubuntu. Native launchd checks
run inside the two existing Darwin installer jobs, after release packaging,
using that architecture’s compiled service. Each architecture therefore requests
one macOS runner instead of separate installer and launchd runners. The protected
reports require the installer workflow to succeed when packaging is selected, or
to be skipped otherwise; a failed scope, cancellation or missing result fails
closed. Main retains both native architectures and every lifecycle assertion.
The installer baseline is frozen once in Validation scope; the platform matrix
then starts alongside the other suites. Standalone installer dispatches keep
their resolver job. This removes one runner allocation from native PR plans
without resolving different releases on different platforms. Windows Bun-free plugin,
frozen-action and command assertions now run in both Windows installer jobs;
there is no separate Windows runner. Fixtures keep their isolated homes/state.
The two protected macOS names still aggregate the complete native workflow.

Native packaging also runs `test:install-linux` in the existing Linux x64
installer-upgrade matrix job. The shared selection explicitly includes installation
scripts, generated/Homebrew bootstrap sources, core install code and connection
registration. Its failure blocks the existing installer result required by
Delivery checks; protected report names are unchanged. All main pushes select it.
The Release Linux x64 package job runs it on the archive before publication.
Local source gates do not implicitly run Docker; use the command explicitly.

Tooling-only PRs use `scripts/validation-scope.ts` in CI and pre-push. The complete
diff must contain only `scripts/agent/**` (including tests),
`docs/agent-development.md` and `changes/<slug>.md`. Empty diffs and any other code path retain ordinary scope.
Both sides of renames count. The mode runs the complete static lane and affected
unit tests (or the agent test inventory for uncovered agent modules), and skips
World browser suites, behavioral verification, Windows installation and installer
upgrades. macOS jobs still report their protected names without native work.
`Delivery checks` requires repository validation and macOS success, and the exact
expected skips; failure, cancellation or missing results fail closed. Only a
title or description edit reuses an earlier tooling result with the identical selection. Other classified PRs use the suite rules below; unknown paths retain the full matrix.
Main pushes and explicit full local gates always run everything.

### Shared suite plan and sharding

Any `openspec/` change selects the feature-map, notes/link and feature-reference
tests in CI and pre-push, including delta-only edits and incremental pushes.
Strict OpenSpec validation and capability-notes link checks run in the static lane.
Catalog checks are selected for browser sources, scanned server memory-store
directories and storage notes, whose runtime scans have no import edges.
Help and file-size checks already run for every static selection.

`validation-scope.ts` applies the affected import graph to the complete PR; unknown
paths, workflow/gate policy and configuration select every suite. A full-gate
incremental delta also escalates all suite families, including World,
even when the triggering input was reverted out of the net PR diff. Verification
runs for model/tooling/OpenSpec inputs or an owner with a maintained model.
Model-free alternative-evidence owners retain affected consumer tests and the
cheap `scripts/verification-coverage.test.ts` inventory check. Coverage inventory
edits limited to explicitly model-free areas use that check; changed model
mappings, transitions out of a modeled status, changed schema metadata and an
unavailable baseline retain the model gate. World browser suites
are the nearest consumers; web suites come from their maintained inventory.
World runtime changes also select the dense end-to-end World suites
(`worldRuntimeSuites`: production and concurrent contexts, terminal handoff).
Native checks cover install/plugin/package inputs and the import closure of the
compiled service/plugin entry points and explicitly native test consumers,
compiled `scripts/build-version.ts` metadata and installation consumers. Changes
to tests explicitly named by the installer upgrade, Windows plugin and native
launchd jobs also select packaging, including when incremental unit scope narrows.
The selector derives these consumer paths from the workflow commands; there is
no separate test allowlist to maintain. Other test-only changes retain their
existing scoped selection. The agent-tooling exception remains explicit. The native storage
command includes every maintained storage `*-crash.test.ts`; the installer
workflow regression derives that inventory from the suites rather than keeping
a second list.
Browser-only shared modules no longer select native runners by directory alone.
Unknown inputs still select the full gate; main's complete plan is unchanged.

Main and non-PR dispatches force the full plan. Code receives all static checks;
ordinary docs receive `check:docs`. Non-browser tests and web suites are partitioned
into two disjoint inventories. Unit shards start alongside static checks, and
Repository validation still requires both. Six World shards use longest-first assignment
from `scripts/world-browser-timings.json`; only relevant shards/suites run.
TownCanvas retains all 22 parameter cases across five files sharing one harness.
Each case pins its exact CSS viewport through Chrome device metrics, with focus
emulation, and fails when the page measures another size (`--window-size` alone
gives a 390px case a wider viewport).
A browser shard-table edit runs the browser inventory tests and all registered
World/web suites, without escalating to native or model work. Executable gate
policy still selects the full matrix. Browser jobs use the pinned test Chrome
(`tools/chrome/test-chrome.json`) and never retry. Timing is not a CI check: the
separate, non-blocking World latency trend workflow measures the dense suites on
quiet runners nightly, for main pushes and `latency-trend`-labelled PRs and reports them
beside main's recent runs on the same CPU model.

The [Town golden-image report](SCREENSHOTS.md#town-golden-image-report) remains
quarantined to manual dispatch after #1282; automatic PR/main/nightly reporting
does not run. A manual report ordinarily runs once per viewport in its own
15-minute advisory job. The explicit stability input selects twenty runs and the production-source
visual mutant/restored-baseline control, with a 40-minute job ceiling. It shares the machine-wide browser
queue locally, uploads current images and mismatch diffs even on failure, and never
changes reference images in CI. Its opt-in test is excluded by default from visual
acceptance in the protected gate; comparator and workflow unit tests run normally.

Three verification runners partition the complete accepted model inventory by
longest-first measured work (`scripts/verification-timings.json`). Both tables
name their source CI run; update weights from retained JUnit/manifest durations
when rebalancing, with each original case/model retained exactly once. Weights
are planning estimates, not timing assertions; new model inputs require a weight.
Changes to the shared assignment algorithm or model weights run verification. Each
runs the maintained focused workers inside the enforced 4 GiB/no-swap/two-CPU
envelope with the existing OOM/cancellation and diagnostic controls. The
payload and supervisor occupy separate delegated cgroups: the memory limit and
peak cover the whole payload, while the surviving supervisor retains accounting
after payload-wide OOM kills. The service-wide CPU quota covers both siblings.
Shard artifacts cannot establish canonical success. The aggregate downloads all group
artifacts, selects each newest attempt, requires complete model coverage and
current source/tool identity, and verifies every group's retained accounting.
It publishes one canonical manifest including the three resource records. The
single-machine canonical gate is unchanged and still rejects filters.
The long core runtime model owns a dedicated shard. Its independent fault controls
run two at a time within that shard's existing resource envelope. Each worker
reuses its owned checker sequentially, avoiding a JVM startup for each fault.
Each command retains its 240-second deadline; the session shares the existing
outer worker deadline, memory cap and cancellation/drain. A checker failure
ends the worker instead of relaunching a failed check. Every model fault, trace
replay, production control, positive seed and sensitivity check remains. After
exhaustive rejection of the publication-foreground fault, replay materialization
samples its six existing model actions instead of searching unrelated families;
the generated trace still must diverge against the real implementation. Positive
sampling and exhaustive successor sets are unchanged. SQLite replay fixtures
commit their initial schema/settings together; replayed writes still use FULL
durability and the original transaction/crash boundaries. The appearance capacity
regression keeps all 1,030 close/prune cycles through the production BoardStore
with its memory backing seam; file persistence and crash durability retain their
separate real-storage tests. Ranger replay initializes the current empty schema
through production storage once per process and copies that closed fixture into
each trace’s private directory. Every trace still runs real SQLite save, rollback,
close and reopen with FULL durability; constructor mutants keep cold initialization.
Each fresh model execution still replays every sampled trace. Complete passing group evidence may be reused as described below.
Local model pools retain sequential controls by default. Progress snapshots are
serialized and cancellation drains all admitted controls. The verified checker
cache is keyed by its committed lock and revalidated by setup; it contains no run
evidence. A failure before execution can have no manifest: upload warns in that
case, while the primary step stays red and aggregation still refuses missing evidence.

World browser shards run full scenes one file at a time. Two simultaneous
SwiftShader scenes competed for hosted-runner CPUs and caused progressive-control,
focus and capture-fencing failures. The explicit lightweight DOM/transport list in
`scripts/world-browser-suites.ts` runs two files concurrently in a separate batch;
new suites default to isolation. Cases within each World file remain serial.
Each case keeps private profiles, ports, RPC state and result gates, and retains
every viewport, assertion and existing deadline. Pointer journeys clear hover
cards between actions: camera moves can leave a previously hovered room summary
over the next seat. The owner-topology journey deliberately starts that step with
a hovered plaque and verifies the seat receives the pointer before pressing it.
It holds the launcher's catalog until Terminal appears, then waits for the
catalog to paint before locating and pressing Terminal: that response grows and
recentres the dialog. Both presses verify the real pointer target.
Its shard weight uses the retained hosted duration (170.387 seconds), replacing
the 38.4-second local estimate; weights never set test deadlines. Both batches
publish distinct JUnit/timing artifacts; a failed batch stops the runner. Web
browser shards retain two-file concurrency.

For repeated World acceptance, add the `world-browser-stability` PR label before
opening the PR or before its next CI run. It selects the full fresh plan, even
for metadata events, and runs each of the six World shards three consecutive
times. Each pass includes both batches and uses fresh case profiles; receipts
include `pass-1`, `pass-2` and `pass-3`. Any failure stops that shard without
retrying or reusing browser evidence. The outer job guard is three times the
ordinary 15-minute guard; individual case deadlines stay unchanged. Remove the
label after acceptance to return subsequent runs to the ordinary plan.

The lighthouse fixture deliberately holds overflow projects' reads until all
visible lamps render. That intermediate state has twelve lamps and twelve piers
in the usual desktop town, before the thirteenth (overflow) pier arrives. Its
readiness predicate waits for both lamps and piers before checking stacking at
every zoom. This guards the incremental-read race exposed by #1068's shard layout;
it does not depend on earlier suites, a shared Chrome profile or cached evidence.
Pages reuses film media only with an exact render-input cache key, with no fallback
prefix. A cache miss still renders the full film. Main latency measurements retain
all four suites, paired over two quiet runners with a fresh quiet check before
each suite. This reduces that workflow from five jobs to three; queue delays
remain visible in health reports.

`Repository validation`, `Web browser tests`, `Behavioral
verification`, `Delivery checks` and both macOS report names remain. Leaf jobs
report their check results immediately on completion; aggregate jobs require
success from all applicable leaves. No crew automation or branch protection is
changed. Actual elapsed CI times come from workflow runs, rather than from a
claimed bound on shared hosted runners.

The size ratchet evaluates the proposed merge into the target against main's
ratchet policy. A branch behind main inherits main's lowered ceilings, while a
branch that restores a ceiling fails. Conflicts fail the check. Tracked working
edits are included through a temporary index; HEAD and staged contents stay intact.
Refresh main before pushing to update the proposed merge input. For stacked PRs,
`bun run check:size origin/main <target-ref>` or
`HERDR_WORLD_RATCHET_TARGET=<target-ref>` selects the actual target independently
of the main policy baseline. CI passes the event's exact base SHA, so a merge into
a stale stack is checked as that merge, rather than silently integrating main.
Draft PR descriptions should pass `check:pr-body` before creation, using the same
policy functions as Validation scope.
Pre-push also checks those policies against the complete PR diff and the existing
PR body, or the intended body named by `HERDR_WORLD_PR_BODY`. Existing PRs use
their immutable base commit, including stacked PRs. GitHub records that commit
at the PR's last push, so when it is an ancestor of `origin/<base branch>` (the
branch merged a newer base), the hook uses that newer commit, as CI does; a
rewritten base keeps the recorded commit. A first push without
a body must carry the fragment/capability notes changes needed to pass on their own.

Main pushes keep a running check and retain only the newest pending run. Main
gate accounts for the intervening merges when attributing a later failure.
Avoid a second scheduler or independent platform scope decisions around this
shared policy.

## Content reuse and test placement

PR selection remains conservative: static checks and affected non-browser units
run before push; affected browser suites and applicable complete model groups
run in CI. Gate/configuration and unknown inputs still select everything. The
budgets are targets: two minutes before push, eight minutes median PR feedback
and about ten jobs for web-only work. Native-sensitive changes retain their full
platform assertions and can exceed that target. Main executes everything fresh.

`scripts/ci-content-key.ts` walks the maintained import graph from the runner or
compiled application entries, including the standalone storage worker. Explicit
inventories bind models, adapters, seeds, tooling/locks, workflow commands,
packaged public assets and notices. Newly imported production dependencies and
new inventory files enter the hash automatically. Unresolved relative imports
widen to every tracked byte. The shared model runner imports all adapters, so its
closure is deliberately conservative; this is not a manually maintained list of
production owners. Group membership, actual Bun/Node/Java identities, OS and
architecture also enter each model key.

On a PR, an exact model-cache hit is validated against current fingerprints,
canonical group membership, complete original manifests, current tools and the
successful enforced resource record. Cache saving and aggregation read actual
`resources.json` reports, excluding readiness-only cancellation-control directories;
each group must still have exactly one valid enforced report. Missing, malformed or changed evidence runs
the entire group afresh. Restore/publication errors cannot silently combine
partial and fresh evidence. Original manifests and resource accounting remain in
an `origin.json` artifact. Aggregation checks restored artifacts against that
origin, binds the current complete source inventory and records `ran`/`reused`,
content hash and origin run/revision for each group. Reuse does not claim a new
execution at the current revision. The checker cache is separate. Main, nightly
and release events never restore model results. GitHub cache visibility still
applies: default-branch evidence is available to PRs; unrelated branch-local
caches are not a global trusted store. A miss always executes.

Installer package keys bind the same production input graph plus platform,
runner-image version and frozen stable baseline. The synthetic RC build number
derives from the content hash so an unchanged build does not acquire a different
embedded version on every run. Only builds are reused: native installation,
upgrade, rollback, SQLite crash, plugin and launchd assertions still execute.
Main and nightly rebuild packages. The nightly installer workflow retains all
six platforms. Newest-core drift continues in its existing nightly workflow;
latency keeps its optional PR label; golden images retain all five viewports.
The golden workflow retains the renderer import graph and asset inventory scope
check before installing Chrome; its automatic events remain quarantined.

The production boot browser journey builds with the release Vite configuration
and loads the unchanged packaged index/main entry from a loopback static fixture.
It seeds sanitized v0.3.5 browser preferences, checks startup, actually backgrounds
and freezes/resumes Chrome, observes the offered build update without a reload,
and replaces an older worker URL with the real activated notification worker.
The previous release had no notification worker: that stale-worker case is a
separate #965 scenario, not a fabricated v0.3.5 artifact. HTTP runtime responses
are synthetic; no World server or real terminal starts in this small browser test.
Real agent/terminal/channel journeys belong to the maintained release walk from
#1023. All-channel prepublication staging from #1044 remains required.

Town and shared-creation fixtures share immutable JS/CSS bundles across cases;
each retains private application state and Chrome profiles. Shared creation
waits for conditions at animation frames instead of a fixed 40 ms polling step;
its negative-observation dwell checks remain. The initial 36 World weights were
refreshed from run 44600794516's retained per-file timings (including setup).
With subsequently added suites and the hosted owner-topology duration, the
43-suite inventory balances to 311–313 seconds of serial work per shard before
two-file concurrency. Every viewport and behavioral assertion remains: the
animated layout cases exercise different scales, aspect ratios, slow frames or
desktop/phone controls. We did
not replace those cases with screenshots that would lose their assertions.

Protocol tables reuse the official recorded native-address vectors and the
reported prefixed spinner titles. Real sanitized Codex/Claude screen captures
inside synthetic transcript envelopes exercise same-size, same-metadata cache
rewrites; provenance stays in the adjacent captured-layout README. These cheap
seam tests add no model or product contract.

Workflow source assertions for static/docs command spelling, the duplicate shared
scope block and the standalone ratchet environment check were removed.
`scripts/gate-commands.test.ts` executes gate coverage/order/failure propagation;
`validation-scope.test.ts` exercises selection, native consumers and the built-entry
boundary; `ci-delivery-result.test.ts` exhausts failed/missing/skipped dependency
results. Workflow dependency, protected-name and native-assertion wiring checks
remain. These deletions reduce duplicated maintenance, with no claimed CI minutes.

## Health and delivery measures

`bun run ci:health --days 3` uses authenticated `gh` reads and prints one report;
it writes no files and never retries. Days are a rolling UTC window, 1–30.
`bun run ci:health --reference-run RUN_ID` uses two reads for a completed successful
run and reports summed runner-minutes, active jobs and event-to-result time. It
also prints this checkout's web-only, server-only and install-touching scope
projections against that measured full reference. The after runner-minute figures
are conservative full-work estimates; cache-hit savings and hosted queue behavior
need a delivered CI run. Do not present a projection as measured after feedback.

The rolling report's fixed budget is 100 GitHub API requests: at most ten 100-run pages, fifty PR
job pages spread evenly across the window, six other workflow job pages, eight
earlier rerun attempts, one delivery query and twenty immutable release comparisons.
Caps and incomplete inventories are printed. Required inventory/query errors fail
the command. Unavailable optional job, attempt or ancestry reads are named in the
limits and omitted from those measurements, without retrying or fabricating data.

Pass/fail/cancel rates use all inventoried PR CI runs, including active/other in
the stated denominator. Time to green spans event creation to the successful
workflow's last update, including runner queues, dependencies and any rerun delay.
Job execution and queue waits use the sampled latest job attempts: queue is job
creation to runner start, excluding dependency time. Failing-step counts take the
first failure in each leaf job, omitting named aggregate propagation steps and
later upload errors; inspect that leaf's log before assigning cause.
The unchanged-commit observation samples rerun events including red final
attempts and their preceding attempts, rather than successive branch pushes.
Reruns are self-selected and can rerun only failed jobs: this diagnostic sample
is not a claim of 98% reliability; fewer than fifty observations cannot establish the 49/50 target.

Delivery frequency counts merged main PRs and published stable releases per day.
Lead time starts at the first PR commit's recorded commit date, with PR-open time
reported separately. Release containment compares immutable commit SHAs and
requires complete ancestry (the 250-commit API bound is checked); absent ancestry
is unknown. Squash/rebase metadata and capped history limit these measurements.
Merged fixes newer than the latest publication are shown as awaiting release.

A fix title/label alone does not identify a failed deployment. For attributable
change failure and recovery numbers, put `Regression-of: #123` and/or
`Affected-release: v0.3.5` on separate lines in the correcting PR body. These are
optional evidence links, not merge requirements. The report counts affected
in-window merges/releases, then measures recovery from the affected release's
publication to the first release containing the correcting merge SHA. Linked
unreleased incidents retain their current age. Unlinked fixes are counted
separately and make failure rates incomplete; an absent link is never evidence
of zero failures. Production incident discovery is not inferred from a red CI run.

## Diagnose a red run

1. Start with the failed leaf job. A red Delivery checks result reports a failed,
   cancelled or missing dependency; it is not another independent failure.
2. Compare the failing assertion with main and other PR runs before attributing
   it to a PR. The same browser fixture failing across unrelated branches is a
   shared investigation, not a reason to repair every branch separately.
3. Keep native installer and plugin lifecycle failures distinct: archives and
   service-manager behavior have different acceptance boundaries from browser
   tests. Do not remove them merely because they share checkout/build steps.
4. Main gate alerts on the first red main run; it never reruns one or classifies
   a failure as a flake. Read the failed job, then fix or revert; rerun only
   after a GitHub service failure. A failure creating an alert is separate from
   the original CI failure.
5. Read the current branch rules before calling a status blocking. The asset
   headroom workflow publishes a status independently; whether it blocks merging
   depends on repository settings.

Workflow regressions live in `scripts/ci-workflow.test.ts`; scope and reuse in
`scripts/ci-reuse-full-check.test.ts`; aggregate acceptance in
`scripts/ci-delivery-result.test.ts`; Main gate alerts, reverts and resolution
in `scripts/main-gate.test.ts`. Native, release and browser workflows retain their
own platform and consumer tests. These finite scheduling and result-selection
checks exercise the tooling directly; application model contracts and their
mandatory consumers are unchanged.

The native installer matrix also runs the auto-sync runtime-status crash suite.
It repeats source and standalone embedded-worker import, commit, acknowledgement
and drain schedules against each target's actual SQLite. These process-crash
checks do not establish physical power-loss durability.
