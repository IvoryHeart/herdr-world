# Design

Use release-please's standard simple strategy and generic annotated TOML updater,
in PR-only mode. Squash-merged fix/feat titles replace fragments. The owner tags
before the next release-please run. GITHUB_TOKEN-created PR checks are dispatched
automatically by resolving its same-repository standard manifest PR branch.
The pinned release-please CLI's `release-pr` command preserves PR-only mode and
passes a dispatched `release_as` through `--release-as` in manifest mode. The v4
action reads that input but drops it in its manifest loader. Validate explicit
versions with the publication version pattern before invoking the CLI; omit the
flag for scheduled/default runs. Keep overrides ephemeral and configure the
package with release-please's `versioning: "always-bump-patch"`: every release
bumps the patch by default regardless of the fix/feat mix; minor and major
versions require an explicit `release_as`. Direct workflow/config subprocess
tests and upstream dry runs check version selection; the real tag-plan fixture
checks RC promotion.
After all channels publish, the tag workflow completes release-please's label
lifecycle on the single merged release PR whose merge commit equals the validated
tag commit. Pending and already-tagged labels permit an interrupted relabel to
retry; absent or ambiguous PR identity fails closed. Block markers around the TOML
version retain Windows installer's plain-assignment parsing.

Only tags and nightly build native candidates. Acceptance consumes exact native
archives and npm tarballs, running upgrades and real-agent starts. The standard
immutable Actions artifact seals the tested package set within that workflow run;
reruns reuse it or rebuild and repeat all acceptance when unavailable. The seal job
runs only when every contract job succeeded (cancelled is not success) and writes
`seal.json` with each contract job's result; Release reuses retained bytes only
when that record belongs to the same run and is all green, otherwise it rebuilds.
No cross-run main authorization, receipt or custom publisher remains.

Use softprops for GitHub assets, npm publish --provenance for tarballs and mislav
for the tap proposal. Mislav updates only the first URL. Our existing product
Formula generator owns all four platform URLs and the launcher; the standard
create-pull-request action completes mislav's same branch with those tested inputs
and the tap's own install check. Only `homebrew-pr` uses the tag-only `release`
environment, where `HOMEBREW_TAP_TOKEN` lives; npm keeps OIDC trusted publishing
without an environment. Find/reuse an existing proposal before invoking
mislav; serialized release runs prevent duplicate proposals. Compare existing
GitHub bytes/npm integrity before skipping them.
Explicit job status conditions keep downstream publication running when a full
rerun skips the candidate because its tested artifact was retained. The summary
accepts only that intentional skip, requiring every publisher and label job to
succeed.

Linux PR jobs retry failed test steps once within the job. Main reports immutable
PR proof without running heavy jobs; absence stays visible in the main-red issue.
Nightly provides native/storage/plugin and running upgrade signal without a gate.
Keep stable Homebrew opt registration and owned-service migration before cleanup.

Direct workflow graph, real subprocess/retry/registry fixtures and OS channel
acceptance cover the ordering/recovery boundaries more directly than an abstract
model of GitHub/npm/Homebrew. Hosted token, native service and RC behavior remains
platform acceptance. No local test claims to execute publication or owner merges.
