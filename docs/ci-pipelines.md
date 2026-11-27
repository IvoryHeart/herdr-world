# CI pipeline ownership

**Delivery checks** is the single required aggregate. Independent review remains
required. The native launchd shim reports have been removed.

| Entry point | Responsibility |
| --- | --- |
| Pre-commit | Read-only formatting/lint and staged agent-file guard |
| Pre-push | Read-only formatting and privacy scan of every pushed ref, including tags |
| Privacy | One scan for each PR open/synchronize/reopen, plus explicit bot dispatches |
| PR CI | Linux static, affected units, browser shards and behavioral verification; description policy remains in CI |
| Merge queue | Fresh Linux validation of the queue's combined commit; the same required Delivery checks aggregate |
| Native checks | Tags and nightly only, including packaging changes |
| Main CI | Report the merged PR's successful identical tree; missing evidence raises the main issue, without running suites |
| Release tag | Build each native package once, test installed channels and agents, audit shipped dependencies, then seal |
| Nightly native | Full native/platform and running-service channel upgrade signal; maintain one issue on failure |
| Main gate | Keep one red-main issue, retry infrastructure once, close on a later green main; never open revert PRs |
| Release PR and Release | [Three owner steps](release.md); release-please and standard publication actions |
| Pages, latency, golden images, asset headroom | Separate workflows filtered by their actual inputs; advisory measurements never gate Delivery |

## Check commands

`bun run typecheck:quick` checks all three TypeScript projects. Use focused
`bun run test <path>` while iterating. `check:static` retains notices,
size, formatting/lint, types, build, site and OpenSpec checks; CI runs that lane
alongside non-browser shards. `check:changed` remains an explicit local affected
check and `check:delivery` an explicit complete local gate. Neither is a push hook.
`check:source` is a local compatibility command, not a release gate.
`check:pr-body <file> <base-ref>` validates the exact committed PR description in
CI and before handoff. `check:dead` is read-only unless given `--prune`.
`check:privacy --range <base-ref> <head-ref>` scans committed additions; the hook
instead checks every actual pushed ref. Do not bypass hooks.

## Scope and scheduling

CI listens to PR open/synchronize/reopen. It does not listen to `edited`.
`labeled` starts jobs only for release previews, browser stability and latency
opt-ins on open PRs. Unrelated labels and closed PRs start no runners.
PR CI validates the proposed merge and uses one selection from
`scripts/validation-scope.ts`. Scope includes both sides of renames and the
complete PR, even if incremental unit scope narrows. Unknown/configuration
changes select full Linux validation. Packaging scope remains descriptive; every
PR check runs on Linux. Native storage/plugin/launchd checks and running upgrades
belong to the nightly or release candidate, never a PR matrix.

Scope checks out the complete Git history with `filter: blob:none`. The PR
description policy runs as its own leaf after scope, alongside static checks,
units, dependency security, World and web browser shards, and model shards.
**Delivery checks** depends directly on those leaves and requires each selected
lane to succeed; unselected lanes must be skipped. There are no intervening
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
another suite. Nightly catches integration/platform failures as one advisory issue.
PR reuse still requires the same scope and checkout/base/head identities.
The stability opt-in explicitly requests fresh repeated browser passes.

If only **PR description** and **Delivery checks** fail, with scope successful
and all code leaves successful or skipped in the same run, correcting the
body and adding an eligible label permits fresh validation. This also works after
**Re-run failed jobs**: successful/skipped leaves may carry earlier attempts,
while the failed description and Delivery must belong to the current attempt.
Failed Delivery evidence is still not reusable, and an earlier code failure still holds the head
red. Rerunning the description job alone replays its original event body.

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

The trusted tracker accepts only runs whose head repository is this repository.
It skips fork runs before downloading artifacts and independently checks the
Actions API source identity before accessing issue history or writing issues or
statuses; a missing identity is rejected. Fork tests still run and report their
local retry results, but cannot add repository-wide flaky history.

Every test shard retains `flaky-tests-*` JSON artifacts, including failed jobs and
previous attempts of a rerun. **Delivery checks** lists every recovered file and
case under **Flaky tests**, and checks the open issue history with a read-only
token inside that same job. When its recorded history plus the current run shows
more than three distinct flaky CI runs in seven days, Delivery checks blocks runs
selecting that file, including a later first-pass success. Attempts
of the same run count once; occurrences exactly seven days old still count.
Once breached, the open cause stays blocked until explicit fix or quarantine;
waiting for the original window to expire does not clear it.

The trusted **Flaky test tracking** workflow uses default-branch code, reads the
source run's artifacts as data, and serializes updates across branches. It creates
one open issue labelled `flaky` per file/case, preserving the run links and owner
notes. Close the issue after fixing the cause; another flake after closure starts
a new issue. To quarantine explicitly, the owner adds `flaky-quarantined` to its
open issue (create that label if needed). Quarantine exempts only the frequency
limit: tests still run and a second failure still fails CI. No automatic skip,
quarantine or issue closure occurs.

The tracker publishes only the optional **Flaky accounting** commit status.
The main ruleset requires only **Delivery checks**; never add Flaky accounting
to its required checks. Queued, late, failed or missing accounting never holds a
merge or changes a completed Delivery verdict. Retry and frequency verdicts live
inside the source run's Delivery checks job. Concurrent runs can pass before
their combined history is recorded; subsequent Delivery jobs enforce that history.

Each completed event discovers completed same-repository CI runs from the last
seven days using the list response's source identity, SHA, conclusion and attempt.
Run listing ends on an empty page: GitHub can return short intermediate pages.
Final Flaky accounting statuses acknowledge each attempt after durable issue
updates. A single issue labelled `flaky-accounting` caches those receipts, so
settled runs need no individual run or commit-status reads. This internal cache
preserves owner prose; only entries outside retained evidence are dropped.
Closing/removing the cache rebuilds it from durable status receipts, replaying
only unreceipted evidence so closed causes stay closed. Existing flaky occurrence
ledgers and commit-status receipts are never trimmed.

Each event accounts at most eight runs: its own run first, then the oldest missed
runs after the saved batch cursor, wrapping back for retries. Failed batches
advance that cursor too, so unavailable artifacts cannot starve later misses. Cold
backlogs drain across later completions rather than exhausting the repository
token shared with Delivery. Discovery, history, status and artifact archive
requests share a ceiling of 80 per event. Archives are decoded as JSON data
without extracting candidate paths. A settled backlog costs one request per
run-list page plus two setup reads,
with further work proportional to new evidence. A missed event or interrupted
write is retried on a later completion, and reruns count once in flaky history.
Artifact/API errors leave that run for retry while other runs continue within the
batch. Evidence older than retention cannot be recovered automatically.
The tracker becomes active on the default branch; previews exercise the read-only
gate and synthetic tracking regressions.

During rollout, old tracker statuses already attached to a PR's head SHA remain.
If **Delivery checks** is green but an old **Delivery checks** commit status is
pending or failed, push a new commit to the PR branch. Rerunning CI keeps the same
SHA and cannot clear that legacy status. The replacement head gets only the new
optional accounting context after this change reaches the default branch.

To inspect it in GitHub, open a PR's **Checks**, select **Delivery checks**, then
read **Flaky tests** in its summary. Open **Actions → Flaky test tracking** for
issue-update and catch-up evidence, or **Issues → Labels → flaky** for causes and
run links. After deployment, check two real PRs: each should become mergeable as
soon as its Delivery checks check run succeeds, without a pending Delivery checks
commit status, and flaky history should retain occurrences from both runs.
The focused `scripts/test-retry.test.ts` fixtures deliberately fail once and pass,
fail twice, crash and trip the isolation guard without creating real flaky issues.

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
The long core runtime and IDE lifecycle models each own a dedicated shard; the
third shard runs every other model, two at a time. Their independent exhaustive
checks (core fault controls; the IDE default, deep and eight flag checks) run
two at a time within that shard's existing resource envelope. Run one at a time,
the IDE checks alone took about 565 seconds on a fast hosted runner and passed
the 930-second shard deadline on one about 1.55 times slower (#1346). Each worker
reuses its owned checker sequentially, avoiding a JVM startup for each check.
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
