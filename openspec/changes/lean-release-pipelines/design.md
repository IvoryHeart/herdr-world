# Design

Use release-please's standard simple strategy and generic annotated TOML updater,
in PR-only mode. Squash-merged fix/feat titles replace fragments. The owner tags
before the next release-please run. GITHUB_TOKEN-created PR checks are dispatched
automatically using the action output.

Only tags and nightly build native candidates. Acceptance consumes exact native
archives and npm tarballs, running upgrades and real-agent starts. The standard
immutable Actions artifact seals the tested package set within that workflow run;
reruns reuse it or rebuild and repeat all acceptance when unavailable. No cross-run
main authorization, receipt, bespoke seal manifest or custom publisher remains.

Use softprops for GitHub assets, npm publish --provenance for tarballs and mislav
for the tap proposal. Mislav updates only the first URL. Our existing product
Formula generator owns all four platform URLs and the launcher; the standard
create-pull-request action completes mislav's same branch with those tested inputs
and the tap's own install check. Find/reuse an existing proposal before invoking
mislav; serialized release runs prevent duplicate proposals. Compare existing
GitHub bytes/npm integrity before skipping them.

Linux PR jobs retry failed test steps once within the job. Main reports immutable
PR proof without running heavy jobs; absence stays visible in the main-red issue.
Nightly provides native/storage/plugin and running upgrade signal without a gate.
Keep stable Homebrew opt registration and owned-service migration before cleanup.

Direct workflow graph, real subprocess/retry/registry fixtures and OS channel
acceptance cover the ordering/recovery boundaries more directly than an abstract
model of GitHub/npm/Homebrew. Hosted token, native service and RC behavior remains
platform acceptance. No local test claims to execute publication or owner merges.
