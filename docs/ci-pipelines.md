# CI pipeline ownership

CI makes one validation-scope decision and passes it to repository validation,
World browser tests, behavioral verification, native plugin checks and installer
upgrades. Delivery checks aggregates their results, including both macOS
lifecycle architectures. The two macOS job names remain separate required checks
for compatibility with branch rules.

| Entry point | Responsibility | Deliberate boundary |
| --- | --- | --- |
| Local pre-commit | Read-only formatting and lint | Quick feedback before a commit; not a delivery gate |
| Local pre-push | `check:changed`, expanding to the full gate for configuration or tooling changes | Affected tests save local work; CI remains authoritative |
| CI on a PR | Validate the proposed merge; check its description and changelog policy | One shared scope decision; native platforms and browser shards keep separate runners |
| CI on main | Validate the integrated main tree | PR success cannot prove the result of later merges |
| Main gate | Classify failed push CI, rerun a recognized infrastructure failure once, or prepare an issue and revert | Does not merge a revert; green main resolves earlier alerts |
| Web asset headroom | Compare PR asset deltas with current main and re-evaluate open PRs after merges | Catches concurrent budget consumption beyond one PR's tested base |
| Prepare Release | Generate and validate release files in a checkout, then open a PR and dispatch CI | Generated files need validation before review |
| Publish Release and Release | Require reviewed, green main; create the tag; validate and package the tagged source before publishing | Publication and archive smoke tests cover artifacts beyond source checks |
| Deploy Pages | Build and publish the documentation site and film | Site publication is separate from application release acceptance |
| Upstream automation | Detect a frozen source release, request local integration and independently review it | External runtime adoption remains a separate decision |

## Scope and scheduling

Code events (`opened`, `synchronize`, `reopened`) receive fresh validation.
Description edits and labels queue behind a running check instead of cancelling
it. They may reuse only a successful full Delivery checks job for the same PR,
base commit and head commit. A newer failed full result prevents reuse of an
older success; API errors and missing proof fall back to full validation.
The release-preview label can therefore request archives without repeating a
successful full check. Other label changes still create workflow runs, but can
take this same short path.

Ordinary Markdown-only diffs receive documentation checks and behavioral
verification under the existing evidence policy. Packaged notices, agent policy,
OpenSpec, verification and tooling do not qualify for this shortcut. macOS jobs
still report their protected names in short runs, with their native build and
lifecycle steps skipped. Their aggregate must succeed in every mode.

Main pushes keep a running check and retain only the newest pending run. Main
gate accounts for the intervening merges when attributing a later failure.
Avoid a second scheduler or independent platform scope decisions around this
shared policy.

## Diagnose a red run

1. Start with the failed leaf job. A red Delivery checks result reports a failed,
   cancelled or missing dependency; it is not another independent failure.
2. Compare the failing assertion with main and other PR runs before attributing
   it to a PR. The same browser fixture failing across unrelated branches is a
   shared investigation, not a reason to repair every branch separately.
3. Keep native installer and plugin lifecycle failures distinct: archives and
   service-manager behavior have different acceptance boundaries from browser
   tests. Do not remove them merely because they share checkout/build steps.
4. Main gate fetches failed-job logs directly from GitHub's API. Terminal colour
   escapes must reach its classifier even when a runner's `gh` version refuses
   to print them. Unavailable logs never count as proof of an infrastructure
   flake. A failure creating an alert is separate from the original CI failure.
5. Read the current branch rules before calling a status blocking. The asset
   headroom workflow publishes a status independently; whether it blocks merging
   depends on repository settings.

Workflow regressions live in `scripts/ci-workflow.test.ts`; scope and reuse in
`scripts/ci-reuse-full-check.test.ts`; aggregate acceptance in
`scripts/ci-delivery-result.test.ts`; Main gate classification in
`scripts/main-gate.test.ts`. Native, release and browser workflows retain their
own platform and consumer tests. These finite scheduling and result-selection
checks exercise the tooling directly; application model contracts and their
mandatory consumers are unchanged.
