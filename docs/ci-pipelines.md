# CI pipeline ownership

**Delivery checks** is the single required aggregate. Independent review remains
required. The native launchd shim reports have been removed.

| Entry point | Responsibility |
| --- | --- |
| Pre-commit | Read-only formatting/lint and staged agent-file guard |
| Pre-push | Read-only formatting and privacy scan of every pushed ref, including tags |
| Privacy | Mandatory step in Validation scope, including PR metadata edits; no separate workflow |
| PR CI | Linux static, affected units, browser shards and behavioral verification; description policy remains in CI |
| Merge queue | Fresh Linux validation of the queue's combined commit; the same required Delivery checks aggregate |
| Native checks | Tags and nightly only, including packaging changes |
| Main CI | Report the merged PR's successful identical tree; missing evidence raises the main issue; independent model jobs warm PR evidence caches |
| Release tag | Build each native package once, test installed channels and agents, audit shipped dependencies, then seal |
| Nightly native | Full native/platform and running-service channel upgrade signal; maintain one issue on failure |
| Main gate | Keep one red-main issue, retry infrastructure once, close on a later green main; never open revert PRs |
| Release PR and Release | [Three owner steps](release.md); release-please and standard publication actions |
| Pages, latency, golden images, asset headroom | Separate workflows filtered by their actual inputs; advisory measurements never gate Delivery |

## Check commands

`bun run typecheck:quick` checks all three TypeScript projects. Use focused
`bun run test <path>` while iterating. `check:static` retains notices,
size, formatting/lint, types, build, site and OpenSpec checks; CI runs that lane
alongside non-browser shards. Its independent commands run concurrently, each
with a separate `static-*.log` in `.agents/delivery/lanes/`; any failure fails the
lane after all commands finish. The terminal names the first completed failure,
and CI's Static checks summary lists every command, outcome, duration and log.
Full CI fits sixteen runner jobs: Validation scope, four combined unit/static/web
runners, six World browser runners, four model groups, and Delivery checks. The
three static groups remain separate: `types` follows unit shard 2, `build` follows
unit shard 3, and `repository` plus shipped dependency security follows unit shard
4. Web browser partitions 1 and 2 follow unit shards 1 and 2. These steps run
sequentially on each runner, preserving the unit and Chrome concurrency limits;
static and browser checks still run after a unit failure but stop on cancellation.
Evidence uploads remain unconditional. Each static group
publishes its own summary and `static-check-logs-<group>` artifact. Documentation
changes run `check:docs` and dependency security on one repository runner.
Combined jobs fetch full Git history for static ratchets after units, filtering
historical file blobs; unit execution inputs remain unchanged.
`scripts/ci-workflow.test.ts` counts runner leaves recursively through reusable
workflows and matrix expansions for default full PR, merge-queue and manual runs;
more than sixteen fails. Optional release previews and browser diagnostics are
outside that default graph. Browser repartitioning must satisfy the same total
job budget; a `max-parallel` limit alone does not reduce the count.
Model groups retain all 27 immutable parts on four runners, with three disjoint
core-control partitions and every fault retained. Packing uses peak memory ×
recorded time and simulates each runner's longest-first queue. Parts refill free
workers only when their padded reservations fit: each reservation rounds 125% of
the recorded peak up to 64 MiB, with 256 MiB reserved for group overhead. Cache
misses use the same admission rule. Failure or cancellation stops admission and
drains started work. The hard 4 GiB, zero-swap cgroup and four-CPU quota remain
authoritative; estimates cannot establish hosted fit. Packing uses complete part
durations from hosted run 46147624726, including replay and evidence publication,
and includes group 1's diagnostic overhead during initial placement and refinement.
World's six runners balance individual case times across three logical queues,
admitting at most two isolated browser contexts in one Chrome per runner. Cases over 50 seconds
are split into independent fixtures with their assertions retained.
A fallback selector owns all new/renamed cases, so stale timing names cannot drop
coverage. `scripts/ci-world-tests.ts` owns this browser scheduling separately from
the existing unit scheduler. Local `check:delivery` uses the pinned Linux Chrome
and starts verification after both browser lanes to avoid CPU contention.
Browser launch and bundle-build phases are recorded once, while each case records
queue admission, context creation, page load, first document frame, real-event waits and synchronous
assertion work. Job summaries and local `test:timings` retain those measurements.
The IDE security fixture uses a generated job-only certificate trusted by its
public-key pin and an isolated CONNECT proxy for its synthetic webview origin;
HTTPS, cookies, CORS and service-worker checks still execute in Chrome.
Browser ownership lives in `scripts/run-browser-tests.ts` around the unchanged
unit/retry executors; pure unit selections never start Chrome. The model tooling
negative control runs once on group 1 in full mode or when its tooling changes.
Static checks never retry. `check:changed` remains an explicit local affected
check and `check:delivery` an explicit complete local gate. Neither is a push hook.
`check:source` is a local compatibility command, not a release gate.

Each combined runner records separate unit, static, security and web outcomes in
its summary and `unit-evidence-*` artifact, even after another lane fails. Delivery
requires all four receipts, checks the actual lane verdicts and also requires the
combined runners themselves to succeed. Setup or artifact failures cannot pass.
The large `uiScale` browser table runs in five disjoint groups under the unchanged
120-second file deadline, each retaining its JUnit/retry report. The last group
also owns future case names. This browser-only schedule leaves units unchanged.
`check:pr-body <file> <base-ref>` validates the exact committed PR description in
CI and before handoff. `check:dead` is read-only unless given `--prune`.
`check:privacy --range <base-ref> <head-ref>` scans committed additions; the hook
instead checks every actual pushed ref. Do not bypass hooks.

### Non-browser units

CI packs the selected unit files onto four runners using the committed
`scripts/ci-unit-timings.json` table. Each runner executes four files at a time,
with the existing maximum of two concurrent cases. The longest files start first;
new files always run with a one-second scheduling estimate. The four partitions
are disjoint and cover the complete selection.

The comparison selector normalizes matrix rows to their unit inputs and compares
steps through the unit executor. Appending static/web/reporting work preserves
the existing unit schedule; changing unit environment, setup, runner, matrix or
commands still requires twenty serial/parallel pairs. Policy-only edits to the
selector preserve the exact comparison executor, assertions and pair count.

The build consumers listed in `scripts/ci-unit-shards.ts` stay on the first shard.
Only a shard selecting those files runs `bun run build`; ordinary scoped units
need no build. Packing includes a 25-second build allowance. The other shards run
from clean checkouts without generated assets, so a new undeclared consumer fails
instead of silently acquiring a second build. The static build remains a separate step on shard 3.

The timing table was bootstrapped from Bun 1.4.4 Linux x64 serial JUnit. It records
the outer file-suite time, including setup, without counting nested describe
suites twice. Its versioned millisecond format also feeds Bun’s `--timings`,
which makes the parallel runner start the longest files first. To refresh it, download the `unit-evidence-*` artifacts and pass
their serial JUnit reports to
`bun scripts/ci-unit-timings.ts <serial-junit.xml> ... > scripts/ci-unit-timings.json`.
Multiple observations use the median per file. Timing changes select full validation.

Changes to the CI unit execution inputs, CI test entry, test runner, unit packing,
timing or comparison executor require **twenty serial/parallel pairs on every unit
shard** before Delivery passes. The order alternates between serial first and
parallel first. Each pair uses the same selected files and existing retry policy;
first-attempt JUnit must retain every case and skip, with zero new parallel
failures even if retry recovers them. Normal PRs execute the unit lane once.
Comparison jobs have a separate 120-minute allowance; individual test deadlines
and the normal 20-minute job limit are unchanged. `unit-evidence-*` retains JUnit,
command logs, case/file inventories and elapsed times; the job summary records the
twenty completed pairs. Retry-once verdicts remain required; `flaky-tests-*` accounting evidence is informational.

## Scope and scheduling

CI listens to PR open/synchronize/reopen and metadata edits. Privacy scans the
introduced commits and current metadata before scope/reuse admission. Each PR has
one concurrency group with cancellation enabled, so a newer event cancels the
superseded run. A `closed` event runs only a small cancellation job: it snapshots
that PR's active workflow runs and cancels them without starting any test lane.
`labeled` starts validation only for release previews, browser stability and
latency opt-ins on open PRs; unrelated labels skip all validation runners.

The default full CI graph has sixteen jobs. A web-rendering PR can additionally
start one Town golden report and one asset-headroom report (eighteen total);
`latency-trend` explicitly adds two measurement jobs and its report (twenty-one
total). PR opening/reopening also runs the single release-note label job;
synchronize pushes do not. Their path filters cover render inputs and web build inputs respectively.
Privacy adds no jobs, and the daily flaky reporter adds no per-push run. Optional
release previews and diagnostic comparisons are reported separately.
PR CI validates the proposed merge and uses one selection from
`scripts/validation-scope.ts`. Scope includes both sides of renames and the
complete PR, even if incremental unit scope narrows. Unknown/configuration
changes select full Linux validation. Packaging scope remains descriptive; every
PR check runs on Linux. Native storage/plugin/launchd checks and running upgrades
belong to the nightly or release candidate, never a PR matrix.

Runtime-loaded check assets have explicit ownership: `__snapshots__/<test>.snap`
selects that adjacent test, Town golden PNGs select their existing advisory
**Town golden images** comparison, and help WebP files plus
`web/src/help/pictures.json` belong to the static lane's `help:check` (and its
affected tests). Asset-only edits do not select production boot or World runtime
journeys. Missing consumers and unknown assets keep the full-mode fallback;
deletions and both sides of renames retain their consumers. Golden comparisons
remain advisory and help picture generation remains an explicit capture command.

Scope checks out the complete Git history with `filter: blob:none`. The PR
description policy runs in Delivery after the code and model evidence steps.
Units carry the existing static, dependency security and web browser checks;
World browser and model groups remain separate runners.
**Delivery checks** depends directly on the combined leaves and requires each
selected lane to succeed; unselected lanes must be skipped. There are no intervening
repository, web-browser or behavioral aggregate runners in the PR graph.
Delivery downloads the model manifests and resource receipts, applies the same
complete source/tool/model/resource checks, and retains the canonical evidence
artifact. This aggregation needs Bun and Git, without Node, Java, dependency
installation or checker setup. Cache admission checks the installed pinned
shard tools. Each bundle retains their full Node/Java/Bun and platform identity;
aggregation recomputes the key from that receipt and the current input closure,
then checks every case's tools and origin artifacts. It never probes Delivery's
unrelated Node/Java installations. Missing or altered receipts fail closed.
A direct manual **Behavioral verification** run
still aggregates its own shards and retains the same canonical artifact.

Main reports passing full or scoped PR evidence only when immutable checkout
proof establishes an identical tree. A newer red/cancelled verdict is never
skipped; absent proof or API errors keep a red metadata result without starting
another suite in that aggregate. An independent **Main model evidence** job runs
the model lane fresh and saves successful per-model evidence in main's cache scope.
IDE lifecycle retains replay plus three check groups; core runtime retains replay
plus three control groups, so their longest controls can overlap other parts.
The 27 immutable model/part identities are packed longest-first by recorded
resource-step times from main run 46077711273 into four balanced groups
(`scripts/ci-model-plan.ts`). Each group admits at most four concurrent parts inside one existing
400% CPU / 4 GiB cgroup. Every part keeps its scope, controls, cache validation and
resource receipt; the complete aggregate still requires all 27 parts. A group
cache restores the latest bundle set, and each part independently validates its
current content/tool key before dependency/checker installation. Invalid or
missing parts run fresh. Only main saves successful bundles. Group 1 always
installs locked development tooling and runs `verification:typecheck` and
`verification:notices:check` on the current tree, including complete cache hits.
Its failure blocks Delivery even when every model reuses evidence. Merge groups, manual runs and nightly/release checks
stay fresh. Nightly catches integration/platform failures as one advisory issue.
PR reuse still requires the same scope and checkout/base/head identities.
The stability opt-in explicitly requests fresh repeated browser passes.

If only Delivery's **Check PR description** step fails, with scope successful,
all other Delivery steps successful or skipped and all code leaves successful or
skipped, correcting the body and adding an eligible label permits fresh
validation. Evidence and code failures still hold the head red. Older separate
**PR description** jobs retain their existing recovery behavior. This also works after
**Re-run failed jobs**: successful/skipped leaves may carry earlier attempts,
while the failed description check and Delivery must belong to the current attempt.
Failed Delivery evidence is still not reusable, and an earlier code failure still holds the head
red. Rerunning an older description job alone replays its original event body.

After the owner approves a PR, it joins the merge queue for `main`. GitHub
combines it with current main and any preceding queued PRs, then sends
[`merge_group: checks_requested`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#merge_group).
CI checks out that queue commit and runs the same Linux static, dependency,
unit, browser and behavioral lanes as PR validation, with a full selection.
It reports **Delivery checks** on the queue commit and never reuses a green PR
result. The static ratchet uses the queue's immutable base SHA as its integration target.
Once the queue's checks pass and review requirements hold, GitHub merges the PR.
FirstMate enables the queue in the ruleset after this workflow change merges;
the workflow does not change repository settings.

### Flaky tests

CI retries a failed **unit file** or exact **browser case** once inside its existing
job. Passing files and unrelated browser cases run once; World retries reuse the
already-built browser assets. A recovered case is recorded as **flaky**; a second
failure, missing recovery evidence, crash or isolation-tripwire violation stays red.
Models, static checks, privacy and PR-description checks never retry. Local test
commands do not enable recovery by default.

Each test job writes **Flaky tests** in its own summary and uploads a small
`flaky.json` in a `flaky-tests-*` artifact. It lists every test that needed a retry,
including a test that fails twice. The existing **Delivery checks** job combines
these into `flaky-tests-delivery-<attempt>` and a summary. Reporting, artifact
upload and download failures are informational: each step uses `continue-on-error`.
No issue-history lookup or frequency limit can fail Delivery. A test that fails
its retry still fails its test job.

**Daily flaky tests** runs once a day at **04:17 UTC**, or through **Actions → Daily
flaky tests → Run workflow** on the default branch. It uses default-branch code
with issue-write permission and reads the consolidated `flaky.json` artifacts as
validated data. It starts no workflow in response to CI requests or completions;
cancelled and skipped CI runs are excluded, as are fork or unidentified source
repositories. Fork jobs still show their own retry summaries. Concurrent daily or
manual requests coalesce to one active run and at most one pending run.

The daily report updates one issue titled **Flaky tests**, labelled `flaky`, with
each test, its retry count and a link to its latest run attempt. The window covers
completed CI runs **created in the last 24 hours** on this repository's branches.
Each test counts once per run attempt across duplicate shard evidence; different
attempts count separately. Run discovery continues through short pages until an
empty page. The managed section is a fresh snapshot; text outside it is preserved.
The same issue is reused even if closed, without reopening it. Previous per-cause
issues and accounting receipts remain historical and have no gating effect.

A source artifact/API error is shown under **Incomplete evidence** while other
runs remain listed; only the daily job fails. Fix the artifact/API problem and
use **Run workflow** to refresh the current window. Artifacts remain available for
seven days, but a delayed report does not reconstruct days outside its 24-hour
window. Reused/docs-only runs have no retry evidence; rollout's old inventory
artifacts are ignored. Scheduled runs can be delayed by GitHub.

**Ruleset notes:** the main ruleset requires only the **Delivery checks check
run**. There are no flaky accounting commit statuses or additional required
checks. Daily reporting never delays a PR or a merge, regardless of retry counts,
reporting failures or runner queues.

During rollout, old tracker statuses already attached to a PR's head SHA remain.
If Delivery checks is green but an old Delivery checks commit status is pending
or failed, push a new commit to the PR branch. Rerunning CI keeps that SHA and
cannot clear its legacy status. New heads receive no accounting commit status
once this workflow change reaches the default branch.

After merge, inspect two real PRs: **Conversation → Show all checks** should show
merge readiness as soon as Delivery checks succeeds, with no pending Delivery
checks commit status. **Actions** should show no new **Flaky test tracking** runs
for either PR, including cancelled CI runs. Read the test-job summaries or download
`flaky-tests-delivery-<attempt>` for `flaky.json`; use **Daily flaky tests → Run
workflow**, then inspect **Issues → Flaky tests** for counts and latest run links.
The `scripts/test-retry.test.ts` fixtures exercise transient and persistent
failures locally without creating repository issues. No World preview is needed.

Release/nightly infrastructure failures retain their separate one-time automatic
failed-job retry. Main's issue remains visible through its infrastructure retry.
There are no automatic revert branches or PRs.

## Side workflows

Pages already follows site/spec/tutorial/Help/film inputs and now also follows
release identity and changelog changes. Latency and Town golden workflows filter
PR/main paths; only the latency opt-in label starts a labelled run. Asset headroom
runs for browser/build/budget inputs and remains advisory. Privacy no longer runs
again on all branch pushes. The local privacy hook still guards branch/tag
publication. The broken automatic Help refresh workflow was removed; targeted
manual Help capture remains available when a help entry changes. The broken OpenSpec archive bot was also removed; the
pinned archive helper still supports reviewed synchronization PRs with ordered
archives and rollback at a conflicting delta. Neither retired workflow consumes
runners or writes a bot branch on main pushes.

Only CI subscribes directly to merge groups. Its reusable World browser and
behavioral workflows run through the same aggregate. Privacy scans each PR's
additions and metadata before queueing, with no separate required queue check.
Pages deployment, latency, Town golden images and asset headroom remain side
workflows on their existing inputs. Dependency maintenance/security reporting,
labels, upstream automation, main health, retry handlers, release preparation,
publication and native/manual acceptance keep their existing events. None is
an additional required merge-group report.

## Audited flaky cases

The November 24 audit includes failures preceding fixes already in the integration
base. Keep those fixes and their assertions:

| Audit case | Current boundary and evidence |
| --- | --- |
| Shared creation at 1440px | Close earlier Inspector windows before the pending view-handoff case (`5edf6ad3f`); cold Town renderer readiness is separate from creation readiness. |
| Maximum-scale Town | Production transport negotiates its current snapshot and cases remain serial (`3c4bfca1c`, `740a1dfa3`); both viewport cases retain input/work-count assertions. |
| Town pan frame rate | Establish the overlay compositor layer on the initial paint with a 3D translation; promoting only on first movement raced raster workers. Gesture markers scope metrics; missing content still fails. |
| Owner topology | Plaque cards open on the real click contract (`18811673d`) and camera readiness gates pointer input. |
| Lighthouse lamps | Hold overflow catalogue responses explicitly; visible and overflow lanes settle independently (`fe80db7a6`). |
| Windows Board after-commit | Reap the child after stdio close before reopening/removing its tree (`740a1dfa3`); the crash marker remains the actual commit boundary. |
| Behavioral timeout | Core controls have a dedicated shard, bounded parallel faults and reused checker sessions (`fe80db7a6`); complete verification remains mandatory, with one in-job retry per failed file/case (models never retry). |
| Core/Codex listing | Disable pinned Codex startup updates in the transparent recorder, including cached-update controls (`efddfb837`); every launched identity must still appear in World and CLI. |

Local targeted runs cover the browser cases, fixture/recorder regressions and
Linux storage; Windows/macOS and hosted resource limits retain native CI ownership.
The owner RC rehearsal and week-long measurements remain acceptance evidence,
not a claim made by these local tests.

### Shared suite plan and sharding

OpenSpec edits select capability/source/link checks. Catalog scans retain their
explicit consumers. Model-backed owners select behavioral verification;
model-free owners retain affected tests and inventory checks. World runtime
changes select production/concurrent context suites. Non-browser and web test
inventories are disjoint; browser shards retain the pinned Chrome and existing
isolation rules. Only failed unit files or browser cases retry once; models never retry and timing gates remain separate. See the nightly
latency signal for measured input delays.

The maintained plan (`scripts/ci-model-plan.ts`) gives each model its own job;
IDE lifecycle has four jobs and core runtime has three. Every original check,
replay, witness, production control and sensitivity case remains required.
Each model CI job uses four TLC workers inside an enforced 4 GiB/no-swap/four-CPU
envelope, with the existing OOM/cancellation and diagnostic controls. The
payload and supervisor occupy separate delegated cgroups: the memory limit and
peak cover the whole payload, while the surviving supervisor retains accounting
after payload-wide OOM kills. The service-wide CPU quota covers both siblings.
Shard artifacts cannot establish canonical success. The aggregate downloads all group
artifacts, selects each newest attempt, requires complete model coverage and
current source/tool identity, and verifies every group's retained accounting.
It publishes one canonical manifest including every resource record and requires
every expected part before combining a split model. The
single-machine canonical gate is unchanged and still rejects filters.
IDE lifecycle separates replay from three exhaustive groups containing the default,
deep and eight flag checks. Core runtime separates positive replay/sensitivity
from two exhaustive fault-control groups. Observation base and space admission
each own a job; space admission runs independent exhaustive verification alongside
sampling. Each control worker reuses its owned checker sequentially, avoiding a
JVM startup for each check.
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

PR CI reports `Validation scope`, `PR description`, the static, dependency,
unit, World browser, web browser and model leaves, and `Delivery checks`.
Leaf jobs report their check results immediately on completion; Delivery
requires success from all applicable leaves. Advisory macOS reports remain in
their own workflows. No crew automation or branch protection is changed.
Actual elapsed CI times come from workflow runs, rather than from a claimed
bound on shared hosted runners.

Open **Actions → CI → a run → Summary → Delivery checks → Run timings** to see
the observed critical path, the last-completing dependency at each workflow
join, the longest execution, and each job's execution and runner wait. Reusable
workflows show their last leaf at the join. The read-only report runs after
successful, failed, held or reused validation and never changes a check verdict.
It reads only the current run attempt; on partial reruns it does not silently
mix earlier attempts' jobs into the table. Elapsed time starts at the run's
original `created_at`, including any delay before a rerun.

Runner wait is job `created_at` → `started_at`, excluding dependency waits before
the job enters GitHub's queue. The sum can exceed wall time because jobs wait in
parallel. Skipped jobs are excluded; missing timestamps or API failures are
reported as unavailable. Delivery is still running while it writes the summary,
so run `created_at` → report time is a lower bound. For acceptance measurements,
use the completed job's `completed_at` from the Actions API; downstream preview
jobs and the workflow's later `updated_at` do not extend Delivery check time.

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
Pre-push runs read-only formatting and privacy only. PR description and size
policies remain in CI and the explicit candidate handoff; they never block the
push hook. Main's lightweight report preserves immutable PR evidence.

Avoid a second scheduler or independent platform scope decisions around this
shared policy.

## Content reuse and test placement

PR selection remains conservative: static checks and affected non-browser units
run before push; affected browser suites and applicable complete model groups
run in CI. Gate/configuration and unknown inputs still select everything. The
budgets are targets: two minutes before push, eight minutes median PR feedback
and about ten jobs for web-only work. Native-sensitive changes retain their full
platform assertions and can exceed that target. Main model warming executes fresh checks.

Model keys (`scripts/ci-model-inputs.ts`, `scripts/ci-model-cache.ts`) follow the
selected model, its Quint imports, adapters, shared runners/helpers, transitive
production replay inputs, seeds and locked tools. Runtime dispatch selects that
model's adapter branches; another model's source and unrelated workflows do not
enter its key. Missing imports refuse reusable evidence. Actual Bun/Node/Java
identities, OS, architecture and check-part identity enter each model key.
Installer keys retain `scripts/ci-content-key.ts`'s production entry/worker,
workflow, packaged asset and notice closure, widening unresolved imports to
every tracked byte. Neither key omits newly imported production dependencies.

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
caches are not a global trusted store. Only successful main-push model jobs save reusable evidence. A miss always executes.

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

Validation scope scans all introduced commit messages and additions against every
parent, batching Git reads per parent (including intermediate leaks removed before
HEAD). Unconditional full validation enumerates the tracked test inventory without
building the dependency graph; scoped selection still follows imports. PR code and
closure events cancel obsolete runs; description/label events retain active proof.
Town side workflows include the shared store/API/layout inputs as render inputs.

## Test file deadlines and fixture time

Every test file has a 120-second real-time deadline starting in the module loader,
covering imported dependency evaluation, setup, cases and teardown. Only the loader
publishes a start marker; an injected footer removes it after teardown without
shifting source line numbers. Filesystem events wake the parent, but expiry
rechecks the marker and its unique start token: a missed removal cannot time out a
completed file, and a replacement keeps its own original start time. The parent
runner owns the timer and kills a hung
batch with exit 124, naming the file. Worker file markers use the existing
run-owned temporary folder and are removed with it; they are not application
storage. A stopped Jest/page clock cannot stop this deadline. The optional
`HERDR_TEST_FILE_TIMEOUT_MS` can only lower the limit for watchdog regression
fixtures. Test commands, selection, concurrency and retry admission are unchanged.
Timed World invocations select one known case per process; the final invocation
also owns unknown cases, so neither a long file nor stale timings hide coverage.
The scheduling comparison projects this failure wrapper away, while changes to
commands, arguments or parallelism still require all twenty serial/parallel pairs.

Browser cases share one Chrome and each owns an isolated context. World summaries
retain setup, context/Chrome, load, scene and teardown phases; the shared browser
also reports first-frame, wait and assertion work for each context. Behaviour
fixtures use the injected frame scheduler and light `TownRendererHandle`;
raster, animation and native performance checks keep the production renderer.

Short polling dwells are zero; native condition checks yield task turns.
The fixed-wait allowance is four unit absence checks: two SSH retry checks against
an isolated real-clock child, and two opt-in live core checks without a held-send
signal. Browser allowances are zero. The allowance may only shrink. Task-turn
condition checks are distinct from fixed dwells; native core I/O without a fixture
notification yields to the event loop and rechecks the actual condition.

### Native frame budgets

The World latency trend workflow also runs `bun run test:performance` on its
ConcurrentContexts runner. This separate lane retains all four Town frame-budget
cases and their original thresholds. It uses Ubuntu 24.04, pinned Bun, the reviewed Chrome pin, SwiftShader,
serial case execution and three quiet runs; every run must pass. Busy admission
fails before measurement, and a failed budget is neither retried nor averaged away.
The ordinary World shards keep functional and bounded-work acceptance. The lane
adds no job and preserves the workflow's existing advisory status.

Functional ProductionContexts and ConcurrentContexts cases retain the production transport, real native
input, all assertions and the 5,000 ms RPC deadline, with exactly 16 ordered key
pairs per phase. This finite workload awaits delivery instead of producing more
keys as a slow phase takes longer. Latency/tracing runs retain the original
independent 75 ms schedule; latency CI now requires quiet admission rather than
measuring after a busy-host warning.
