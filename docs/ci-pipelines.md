# CI pipeline ownership

CI makes one validation-scope decision and passes it to repository validation,
World browser tests, behavioral verification, native plugin checks and installer
upgrades. Delivery checks aggregates their results, including both macOS
lifecycle architectures. The two macOS job names remain separate required checks
for compatibility with branch rules.

| Entry point | Responsibility | Deliberate boundary |
| --- | --- | --- |
| Local pre-commit | `check:commit`: no live `.agents/` files, read-only formatting and lint | Quick feedback before a commit; not a delivery gate |
| Local pre-push | `check:changed`: static checks and affected non-browser units; gate/configuration changes run all non-browser units | Affected tests save local work; CI remains authoritative |
| Privacy on every branch push and PR | Scan added lines in every introduced commit for private material, with redacted diagnostics | Independent of PR creation and validation scope; local pre-push scans the actual pushed refs too |
| CI on a PR | Validate the proposed merge; check its description and changelog policy | One shared scope decision; native platforms and browser shards keep separate runners |
| CI on main | Validate the integrated main tree | PR success cannot prove the result of later merges |
| Main gate | Classify failed push CI, rerun a recognized infrastructure failure once, or prepare an issue and revert | Does not merge a revert; green main resolves earlier alerts |
| Web asset headroom | Compare PR asset deltas with current main and re-evaluate open PRs after merges | Catches concurrent budget consumption beyond one PR's tested base |
| Town golden images | Compare five synthetic Town screenshots with stored reference PNGs on PR changes and main | Advisory, separate from Delivery checks; exact pixels with pinned Chrome, fonts, clock and SwiftShader |
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
| `check:pr-body <file>` | CI knowledge-map and changelog policy against a committed PR diff and draft description; optional base ref follows the file |
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

Code events (`opened`, `synchronize`, `reopened`) receive fresh validation.
Description edits and labels queue behind a running check instead of cancelling
it. They may reuse a successful full Delivery checks job, or a scoped job with the
identical selection, for the same PR, base commit and head commit. GitHub's historical PR association can change, so
it is not proof of the tested base. Reuse binds the selected Delivery job
to its run and attempt, reads the full checkout SHA only from that job's checkout
action log, and resolves the immutable merge commit. Its returned SHA must match
the checkout SHA and its two ordered parents must match the requested base/head.
Scoped jobs publish one `[delivery-proof]` record only after all applicable
results pass. Reuse compares every selection field, including ordered test arrays
(the order determines shards), and requires the scoped acceptance step to pass.
A reused result is never fresh evidence. Default leaf checkouts retain the
original event's `GITHUB_SHA`. A newer failed or cancelled candidate prevents
reuse of an older success, even when its Delivery job was never created. A
matching workflow must have succeeded before its job proof is considered;
unfinished or other unsuccessful runs also fail closed. Missing, ambiguous or
expired logs and API errors
fall back to fresh validation for the current scope.
The release-preview label can therefore request archives without repeating a
successful applicable check. Other label changes still create workflow runs, but can
take this same short path.

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
without resolving different releases on different platforms.

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
expected skips; failure, cancellation or missing results fail closed. It never
reuses an earlier tooling result. Other classified PRs use the suite rules below; unknown paths retain the full matrix.
Main pushes and explicit full local gates always run everything.

### Shared suite plan and sharding

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
quiet runners for main pushes and `latency-trend`-labelled PRs and reports them
beside main's recent runs on the same CPU model.

The [Town golden-image report](SCREENSHOTS.md#town-golden-image-report) ordinarily runs once
per viewport in its own 15-minute advisory job. The explicit stability input or
`town-golden-stability` PR label selects twenty runs and the production-source
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
No replay result is cached and all sampled traces still execute.
Local model pools retain sequential controls by default. Progress snapshots are
serialized and cancellation drains all admitted controls. The verified checker
cache is keyed by its committed lock and revalidated by setup; it contains no run
evidence. A failure before execution can have no manifest: upload warns in that
case, while the primary step stays red and aggregation still refuses missing evidence.

HostsFilter's Town frame cases run serially on each browser shard so simultaneous
software GL renderers do not starve their clocks. DOM cases retain concurrency;
the Town cases retain every viewport/assertion and the original 45-second hang guard.
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
their immutable base commit, including stacked PRs. A first push without
a body must carry the fragment/knowledge-map changes needed to pass on their own.

Main pushes keep a running check and retain only the newest pending run. Main
gate accounts for the intervening merges when attributing a later failure.
Avoid a second scheduler or independent platform scope decisions around this
shared policy.

## Health and delivery measures

`bun run ci:health --days 3` uses authenticated `gh` reads and prints one report;
it writes no files and never retries. Days are a rolling UTC window, 1–30.
The fixed budget is 100 GitHub API requests: at most ten 100-run pages, fifty PR
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
