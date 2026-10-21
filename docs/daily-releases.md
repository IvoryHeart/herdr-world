# Daily reviewed patch releases

The **Daily patch release** workflow checks `main` at **06:37 UTC daily** and
can be run manually. GitHub schedules are best effort, so this is not an exact
publication deadline. It prepares at most one release PR when the Unreleased
changelog contains changes, the current stable version has a successful Release
workflow, and no release PR is open. Once a bot release PR exists, daily checks
refresh that same PR when main advances, retaining its target version. It increments
only the patch component:
`0.2.6` becomes `0.2.7`. Empty changelogs and standing known issues do not
produce releases. Minor, major and RC preparation and publication remain manual.

## Review and publication

1. Daily planning dispatches **Prepare Release** with `version=patch` and
   `automatic=true`. Preparation rechecks readiness before installing dependencies.
   It generates notes from Unreleased, exact source/runtime lineage in `UPSTREAM.md`
   and [standing known issues](known-issues.md), then runs repository validation.
2. The bot opens a normal `release/vX.Y.Z` PR with a preparation record in its body
   and explicitly dispatches CI. Human review and all required checks still apply;
   release automation never approves or merges the release PR. Review the generated
   upgrade notes and changelog date, and remove resolved standing issues in a reviewed change.
   Until approval, new reviewed changes on main are incorporated into that same
   PR and its generated notes on the next daily run. A normal merge commit preserves
   the branch history; there is no force-push. CI runs again for each refreshed head.
   Once approved, automatic refresh stops so the reviewed head stays ready to merge;
   later main changes wait for the next patch. No tag exists before reviewed merge.
3. A merged PR event checks for a prepared patch promptly; the daily schedule
   provides a fallback. Publication accepts only the bot's marked release PR,
   its consecutive patch version and actual baseline, and passing required PR
   checks. It finds the version-changing merge on main and tags that exact SHA,
   even when newer commits have arrived on main.
4. The dedicated token pushes an annotated immutable tag, starting **Release**
   once. The existing Release workflow validates, builds all six platforms and
   publishes GitHub assets and npm packages. After npm and both macOS Homebrew
   installation checks pass, it opens or reuses the generated Formula PR and
   merges its exact checked head into the tap, then requests the stable site
   deployment. Only this generated-Formula-only tap PR is authorized to merge
   automatically; the release PR still requires independent human review.
   A release is finished only after the complete workflow succeeds; a partially published release blocks the next
   preparation.

Manually prepared releases use the explicit
**Publish Release** workflow after review and merge. The daily worker skips these;
adding a marker to a human-authored PR does not make it eligible for automatic
publication. Minor/major releases use the existing manual preparation inputs.

## One-time GitHub setup

Create a dedicated fine-grained personal access token for an identity already
allowed to create `v*` tags by the repository's release-tag ruleset. Currently that
is the repository owner. Select only `IvoryHeart/herdr-world` and grant **Contents:
read and write**. GitHub can also require **Workflows: read and write** when a tag
points at workflow changes; include that permission for release tagging. Actions
and Pull requests write permissions are not needed on this dedicated token.
Choose an expiry and rotate the secret before it expires.

Save it as **`RELEASE_AUTOMATION_TOKEN`** under repository **Settings → Secrets and
variables → Actions**. Do not put it in a PR, tracked file or chat. No OpenAI key
or local-machine login is used. The token is passed only to the trusted-main
annotated-tag push step. Planning, PR creation, checks, explicit dispatch and
failed-job retries use the normal scoped `GITHUB_TOKEN`.

Keep Actions' **Allow GitHub Actions to create and approve pull requests** setting
enabled for bot PR creation; the workflows do not use its approval capability.
Keep the existing protected-main review/check rules and protected release-tag
rules. The dedicated token does not bypass the release PR process, and this
workflow does not relax either ruleset. Without the secret, preparation and human
review can proceed, but new-tag publication fails with a setup message.

The separate **`HOMEBREW_TAP_TOKEN`** selects only `IvoryHeart/homebrew-tap` and
needs **Contents: read and write** plus **Pull requests: read and write**. It opens
and merges the verified Formula PR after npm publication and both macOS install
checks. Its job confirms the PR repository, source branch, target `main`, exact
head SHA and one-file scope, and verifies the merged Formula against the release
artifact. Changed heads, extra files, symlinks and mismatched formulas fail closed.
A normal merge respects tap protections; no admin bypass or repository auto-merge
setting is required. If a new required review/check or merge queue blocks immediate
merge, publication fails rather than reporting a queued PR as published. Satisfy
that requirement and retry the same release job. Already matching tap main is a
successful no-op; a previously opened matching PR is reused without duplication.

GitHub documents [token-triggered workflow behavior](https://docs.github.com/en/actions/concepts/security/github_token)
and [tag creation permissions](https://docs.github.com/en/rest/git/tags).

## Recovery and tracing

Each planning or publication run writes its decision and skip reason to its job
summary. The PR body records the baseline and target version; the immutable tag
records the reviewed release SHA. Publication validates existing tags and Release
run revisions before deciding whether to do anything.

- An open release PR owns the version. A matching bot-owned patch PR is refreshed
  from main until approved. Human-authored release-branch commits pause automatic
  refresh to preserve manual notes or fixes; maintain that PR manually. Approval,
  closure or a changed head during validation also cancels submission. A concurrent
  review immediately around a push is governed by protected-main stale-approval
  rules, so only the final head can be merged with valid approval. Manual releases
  and multiple open release PRs block new preparation.
- If a release branch remains after its PR is closed, preparation fails and asks an
  operator to inspect or reopen it; it never overwrites that branch.
- A pending Release run is left alone. A failed Release run is retried with
  **failed jobs only**, preserving its exact tag and version. Inspect persistent
  failures rather than cutting another patch to conceal a partial publication.
- Canceled or indeterminate runs require operator attention. An existing tag with
  no visible Release run also stops automatic publication, avoiding a duplicate
  while GitHub delivers the tag event. Inspect Actions and the tag, then dispatch
  **Publish Release** manually for that version if no run exists.
- A tag at another SHA, a lightweight tag, missing notes, missing/failed PR checks
  or inconsistent preparation metadata fails closed. Never delete or retag a
  published version. Fix the problem through reviewed changes or finish the same
  immutable Release run.

The direct readiness matrix, temporary Git histories and synthetic GitHub API
responses in `scripts/daily-release.test.ts` exercise version selection, merged-PR
identity, rolling Git merges, approval freezes, human-edit preservation, checks,
tag preservation, retries and workflow wiring without publishing.
[Homebrew regressions](../scripts/open-homebrew-pr.test.ts) run the real shell
helper against temporary Git remotes and a synthetic GitHub transport, including
stable/RC publication, existing PR reuse, denied merges, changed heads and
post-merge Formula verification.
They do not establish live token authority, GitHub event delivery, native package
execution or downstream registry availability; protected CI and Release remain
mandatory evidence for those boundaries.
