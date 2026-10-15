# Roamgate upstream automation

World derives source from Roamgate. The synchronization point remains the exact
source SHA in [UPSTREAM.md](../UPSTREAM.md). GitHub detects and queues work; local
Codex sessions perform integration and independent review using subscription
sign-in. No OpenAI API key or hosted model job is required.

## Workflow

[Upstream sync](../.github/workflows/upstream-sync.yml) checks stable releases
hourly at minute 17, or on manual dispatch or `roamgate-release` repository dispatch.
The latter requires a cooperating upstream sender; none is assumed. Payloads never
override the source target. A bot-authored **Upstream integration pending** issue
records the exact stable release and SHA after checking recorded-source ancestry.

Run `bun run upstream:work` locally from the reviewed checkout. It acquires an
exclusive local lock, checks for enabled automation and queued work, and invokes
`codex exec` with cached ChatGPT sign-in. It forces `forced_login_method="chatgpt"`
and removes API-key/access-token environment overrides. It does not read, copy or
upload authentication files. Usage counts against the account's Codex subscription
limits; unavailable quota or expired login can stop a run.
The controller uses `--approve-for-me` with workspace-write and network access
so required Git/worktree operations can receive automatic approval review.
The independent reviewer remains read-only. A rejected operation becomes an
operator blocker rather than bypassing the approval policy.

The local session follows the [integration skill](../.agents/skills/upstream-integration/SKILL.md)
and trusted prompts. It creates isolated worktrees below `.agents/worktrees/`,
adapts the prepared merge, exports a binary patch, and reconstructs publication
in a separate worktree. The push retains the repository's full pre-push delivery
gate. [Upstream publish](../.github/workflows/upstream-publish.yml) validates the
pushed revision and ancestry on main, creates the PR as `github-actions[bot]`, and
explicitly dispatches full CI. It never executes candidate scripts or installs
candidate dependencies. A merge commit preserves the upstream parent.
Preparation and publication refresh main and require its recorded Roamgate source
to equal the frozen source baseline. If a manual integration advanced that record,
obsolete work stops for reconciliation instead of downgrading it. The worker
exports its integration report alongside the patch and forwards it as plain
dispatch data. Initial and repair PR descriptions retain the actual checks,
adaptations, unresolved decisions and knowledge-map explanation. Reports over
12,000 UTF-8 bytes or containing control bytes are rejected, never truncated.

Only one `upstream/roamgate` PR is active. Its upstream target freezes immediately;
later releases wait for merge or closure. A current-head CI failure or change
request permits one automated repair on that branch, without advancing the target.
Further findings require an operator. **Upstream automation blocked** issues stop
new attempts until resolved and closed. Closing a blocked PR without advancing
UPSTREAM.md allows its release to be attempted again.

After successful CI, [Upstream review](../.github/workflows/upstream-review.yml)
queues **Upstream review pending** with the exact head, base and CI run ID. The
next local invocation starts a NEW ephemeral, read-only Codex reviewer with the
trusted review prompt and output schema. It never resumes the implementer's
conversation. The local controller forwards the unchanged verdict to GitHub;
the workflow checks the successful CI identity and current PR head again, then
posts a commit-bound review using a separate reviewer GitHub App.
The exact World base inspected by the reviewer is carried separately from the
Roamgate source baseline. Local submission, hosted planning and final approval
each compare it with current PR/main before accepting the verdict. Advancing only
main invalidates the comparison even when the candidate head is unchanged.

This trusts the authorized local controller to run the reviewer honestly. GitHub
can validate revision/CI/identity, but cannot attest that a model session was
independent. A different GitHub identity is necessary for counted approval;
using the same Codex subscription for both model sessions does not supply it.

Changes to .github or .codex controls stop automated publication before candidate
workflows can run. Preserve World controls or integrate those changes manually.
Changes to scripts, agent instructions, package manifests, lockfiles, hooks,
maintained type/lint/test configuration, OpenSpec or behavioral verification
require human approval. An agent's positive verdict on these changes becomes a
comment. Other positive verdicts can approve and queue normal auto-merge, subject
to all existing required reviews/checks. No ruleset bypass or `--admin` is used.
Final merges must retain upstream ancestry; do not squash or rebase sync PRs.

## Setup

1. On the machine that will perform the work, install the pinned Bun toolchain,
   Codex CLI and GitHub CLI. Run `codex login` and choose ChatGPT subscription
   sign-in; confirm with `codex login status`. Sign into GitHub as the repository
   owner, with permission to push branches and dispatch workflows. Local admission
   requires that identity so failures produce recognized owner-authored blocker
   issues. Hosted failures use the Actions bot. Keep all login caches local.
2. Install a dedicated reviewer GitHub App on this repository with **Contents:
   read** and **Pull requests: write**. Store its ID in the repository variable
   `UPSTREAM_REVIEW_APP_ID` and PEM private key in the repository secret
   `UPSTREAM_REVIEW_APP_PRIVATE_KEY`. Do not grant a ruleset bypass. Verify that
   its approval counts under the active last-push/required-review rules in the
   first PR. Without this identity, use an independent human reviewer; the
   automation cannot manufacture a counted approval from its PR author.
3. Allow Actions to create PRs in repository workflow permissions. Enable
   **Allow auto-merge** and retain merge commits, without relaxing review/check rules.
4. After the reviewed automation PR merges, set `UPSTREAM_SYNC_ENABLED=true` and
   dispatch **Upstream sync** on main. Run `bun run upstream:work` manually and
   inspect its first integration. Set `UPSTREAM_AUTO_MERGE=true` only after
   confirming reviewer eligibility and actual protected CI behavior. Unset leaves
   merge decisions manual. No OpenAI API secret is needed.
5. Schedule `bun run upstream:work` hourly using your system scheduler, or create
   an hourly Codex desktop scheduled task with the prompt below. Use one scheduler
   and one machine for integration. The computer must be available; desktop tasks
   additionally need the app running. The CLI launcher works without the app.

Suggested desktop task prompt:

> Run `bun run upstream:work` once from the reviewed Herdr World checkout. The
> launcher owns the worker lock and handles at most one queued item. Report its
> result or blocker. Do not start another integration, approve or merge a PR.

The one-shot launcher is suitable for cron or a user systemd timer. This change
does not install a machine-specific scheduler or a reviewer App. For an existing
interactive Codex session, use the desktop-task prompt directly. No busy polling
or permanently running chat is necessary.

## Recovery and limits

Set `UPSTREAM_SYNC_ENABLED=false` to stop new hosted/local work. Already queued
merges must be disabled on their PR separately; cancel running jobs or local
sessions separately. After a failed local session, inspect its output and the
blocker issue before retrying. If a process was killed without cleanup, inspect
and remove only its stale `.agents/upstream-local/worker.lock` directory.

Publication or review dispatch is an accepted request, not proof of completion.
Inspect the linked Actions run after failure; missing App credentials leave the
PR unapproved. Fix infrastructure and retry the same frozen revision. If main
advances, update the sync branch and run full CI and independent review again.
Do not advance the upstream target or reuse old approval. Preserve generated
worktrees for inspection; normal operator cleanup is separate.
Blocker creation and admission share the same issue/author predicate: a matching
PR or outsider-authored issue cannot suppress creation of a trusted failure latch.

This extends inventory Q41 (release/package/CI orchestration). Direct tests
enumerate bounded repair/authority cases, reject stale or malformed verdicts,
check subscription-only environment handling and workflow credential separation,
and reconstruct conflicting Git merges with binary patches and exact ancestry.
These implementation checks are preferable to modeling GitHub's review service.
They do not establish model quality, API availability, App eligibility or actual
hosted execution. First-run inspection and all protected platform checks remain
required. Official guidance: [authentication](https://learn.chatgpt.com/docs/auth)
and [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode).

`scripts/upstream-sync-cli.test.ts` exercises the real helper commands with real
local Git graphs and intercepted GitHub/network operations: base movement between
queue/submission/approval, source advancement before preparation/publication,
blocker collisions and both initial and repair report handoffs. These are direct
orchestration regressions; they do not create remote issues, PRs or reviews.
