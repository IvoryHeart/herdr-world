# CI pipeline ownership

CI makes one validation-scope decision and passes it to repository validation,
World browser tests, behavioral verification, native plugin checks and installer
upgrades. Delivery checks aggregates their results, including both macOS
lifecycle architectures. The two macOS job names remain separate required checks
for compatibility with branch rules.

| Entry point | Responsibility | Deliberate boundary |
| --- | --- | --- |
| Local pre-commit | `check:commit`: read-only formatting and lint | Quick feedback before a commit; not a delivery gate |
| Local pre-push | `check:changed`, expanding to the full gate for configuration or gate-policy changes | Affected tests save local work; CI remains authoritative |
| CI on a PR | Validate the proposed merge; check its description and changelog policy | One shared scope decision; native platforms and browser shards keep separate runners |
| CI on main | Validate the integrated main tree | PR success cannot prove the result of later merges |
| Main gate | Classify failed push CI, rerun a recognized infrastructure failure once, or prepare an issue and revert | Does not merge a revert; green main resolves earlier alerts |
| Web asset headroom | Compare PR asset deltas with current main and re-evaluate open PRs after merges | Catches concurrent budget consumption beyond one PR's tested base |
| Prepare Release | Generate and validate release files in a checkout, then open a PR and dispatch CI | Generated files need validation before review |
| Publish Release and Release | Require reviewed, green main; create the tag; validate and package the tagged source before publishing | Publication and archive smoke tests cover artifacts beyond source checks |
| Deploy Pages | Build and publish the documentation site and film | Site publication is separate from application release acceptance |
| Upstream automation | Detect a frozen source release, request local integration and independently review it | External runtime adoption remains a separate decision |

## Check commands

| Command | Coverage and definition |
| --- | --- |
| `check:commit` | Formatting and lint; shared by the Git hook, source checks and static lane |
| `check:source` | Commit guard, asset-building type check and tests; release preparation and tag validation |
| `precommit` | Compatibility alias for `check:source`; not the Git pre-commit hook |
| `check:static` | Notices, fragments, size, commit guard, all three source type checks, Bun type checks, production build, site and specs; defined once in `scripts/check-delivery.ts` |
| `check` | Static lane followed by tests; CI separates browsers through its existing environment selection |
| `check:changed` | Static lane plus affected tests and behavioral verification when required |
| `check:delivery` | Static lane plus all test lanes and behavioral verification |
| `check:pr-body <file>` | CI knowledge-map and changelog policy against a committed PR diff and draft description; optional base ref follows the file |
| `check:docs` | Notices, fragments, formatting, site and specs for qualifying Markdown changes |

The static lane uses `typecheck:quick` because its production build follows.
It retains all three TypeScript projects and production asset checks while
avoiding the second web build previously triggered by server's `pretypecheck`.
Standalone `typecheck` and release source checks retain that asset-building hook.
`scripts/gate-commands.test.ts` executes the entry points with stubbed leaf
commands to verify coverage, ordering and failure propagation without rebuilding.

## Scope and scheduling

Code events (`opened`, `synchronize`, `reopened`) receive fresh validation.
Description edits and labels queue behind a running check instead of cancelling
it. They may reuse only a successful full Delivery checks job for the same PR,
base commit and head commit. GitHub's historical PR association can change, so
it is not proof of the tested base. Reuse binds the selected full Delivery job
to its run and attempt, reads the full checkout SHA only from that job's checkout
action log, and resolves the immutable merge commit. Its returned SHA must match
the checkout SHA and its two ordered parents must match the requested base/head.
Default leaf checkouts retain the original event's `GITHUB_SHA`. A newer failed
full result prevents reuse of an older success; missing, ambiguous or expired
logs and API errors fall back to full validation.
The release-preview label can therefore request archives without repeating a
successful full check. Other label changes still create workflow runs, but can
take this same short path.

Ordinary Markdown-only diffs receive documentation checks and behavioral
verification under the existing evidence policy. Packaged notices, agent policy,
OpenSpec, verification and tooling do not qualify for this shortcut. macOS jobs
still report their protected names in short runs, with their native build and
lifecycle steps skipped. Their aggregate must succeed in every mode.

Tooling-only PRs use `scripts/validation-scope.ts` in CI and pre-push. The complete
diff must contain only `scripts/agent/**` (including tests),
`docs/agent-development.md`, `docs/crew-runbook.md`, `docs/dispatch-runbook.md` and
`changes/<slug>.md`. Empty diffs and any other code path retain ordinary scope.
Both sides of renames count. The mode runs the complete static lane and affected
unit tests (or the agent test inventory for uncovered agent modules), and skips
World browser/latency, behavioral verification, Windows installation and installer
upgrades. macOS jobs still report their protected names without native work.
`Delivery checks` requires repository validation and macOS success, and the exact
expected skips; failure, cancellation or missing results fail closed. It never
reuses an earlier tooling result. All other code PRs retain the full matrix.
Main pushes and explicit full local gates always run everything.

The size ratchet uses the tip of `origin/main` locally and on CI, rather than a
branch's older merge base. Refresh main before pushing. Draft PR descriptions
should pass `check:pr-body` before creation, using the same policy functions as
Validation scope.

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
