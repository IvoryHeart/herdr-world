# Agent development

Herdr World uses native coding-agent conversations, repository instructions, current
OpenSpec contracts and ordinary project checks. Agent work is dispatched by the separate herdr-crew dispatcher; this repo only defines how code is built, tested and delivered.

## Start work

Read `AGENTS.md`, then use [the knowledge map](knowledge-map.md) to find the relevant
contract, source, tests and runbook. Use the [foundation source guide](foundation-guide.md)
when work crosses service, browser or distribution modules. For visual tasks, start
with the [World component routes](../web/src/world/README.md). Locate relevant
headings in large contracts before reading full sections, and widen the read when
the change crosses them.
Resolve any requested parent pull request to its actual branch and commit before
creating a worktree:

```bash
bun run agent:worktree -- create <slug> <parent-ref>
```

The helper places `agent/<slug>` below the primary checkout's `.agents/worktrees/`
directory and rejects unsafe names or unknown refs. `bun run agent:worktree -- list`
is read-only. Do not move, clean or reuse another agent's worktree.

### Capture PR evidence

Use the [capture helper and five-viewport recipe](SCREENSHOTS.md#pr-screenshot-viewports)
for Town, Board and Desk evidence. Start a disposable synthetic fixture and its own
Chrome with a dynamic CDP port, then run `bun scripts/capture-world.ts` with that
port. The entry takes the shared browser queue. Never use fixed settlement sleeps
or a direct screenshot call for PR assets. Supply the fixture's expected-content
selector for populated scenes; empty Board/Desk captures may omit it.

The helper requests current committed draw evidence after each viewport change,
waits for required fonts/images and semantic layout, and crosses a browser paint
opportunity. It checks revision currency before and after the screenshot and writes
only validated images. A deadline, missing content or changed revision fails;
inspect its diagnostic rather than retrying a partial image. Keep receipts and
synthetic originals with the candidate evidence. Independent review and required CI
remain separate acceptance conditions.

### Keep the disk healthy

Many worktrees on one machine fill its disk quickly, and checks that run out of
space fail halfway and leave debris. These rules keep each worktree small:

- `bun run agent:worktree -- prune [--dry-run]` removes worktrees whose work is
  merged and that are clean.
  - **Removed:** the branch has commits of its own (a commit in its reflog, not
    just a fast-forward or reset) that `origin/main` now contains, or the worktree
    is a detached review checkout of a commit in `origin/main` that has been idle
    for 12 hours. The merged local branch is deleted with it.
  - **Stripped:** if processes only sit in such a worktree (an idle shell in an
    agent's pane, say), only its build output goes: `node_modules`, `dist`,
    `web/dist`, `server/public`, the `server/herdr-world` binary and
    `.agents/verification`.
  - **Kept in use:** a worktree a running process uses in any other way (its
    executable, an open file, a path in its command line like a preview
    server's `--directory`, or the working directory of anything but a shell,
    like a dev server) is not touched.
    Filesystem paths must be inside that checkout; `/`, ancestor directories
    and sibling directories do not count. Command-line matching rejects common
    sibling-name continuations; other punctuation conservatively counts as a
    boundary, including Docker mount syntax and shell operators.
    If process inspection is unavailable, pruning conservatively keeps worktrees.
  - **Kept with work:** ignored files other than regenerable build output
    (evidence under `.agents/`, `.env*`, keys, notes) keep the worktree; the
    decision names them.
  - **Never touched:** unmerged, dirty, locked, freshly created or current worktrees.
    Protect a worktree a long-running preview or instance serves with
    `git worktree lock --reason "<why>" <path>`.
  - **Dry run:** `--dry-run` prints the decisions without acting.
- Behavioral verification's checker (about 190 MB) is downloaded once per user into
  `$XDG_CACHE_HOME/herdr-world/verification` (or `~/.cache/…`;
  `HERDR_WORLD_VERIFICATION_CACHE` moves it). Every worktree reads it there after
  checking its digests. Each worktree keeps only its newest four verification runs
  under `.agents/verification/runs`.
- `bun install` hardlinks packages from `~/.bun/install/cache`, so a worktree's
  `node_modules` costs almost nothing when it is on the same filesystem as the cache
  (`agent:worktree -- create` warns when it is not). Do not clear
  `~/.bun/install/cache` (`bun pm cache rm`): every worktree would then hold full
  copies.
- Test runs give tests and test Chrome their own `TMPDIR` (`/tmp/hwt-*`), and
  remove it with any process still using it, however the run ends. A direct
  `bun test` gets the same treatment through `bunfig.toml`. Runs killed outright
  are swept by the next run once their owner process is gone. Other programs'
  scratch directories, such as a desktop Chrome's, are never touched.
- Disk capacity is managed by the owner. Checks do not enforce a free-space
  floor; `HERDR_WORLD_MIN_FREE_GB` has no effect.

## Deliver a change

Start from the owner's requested outcome and inspect existing behavior before editing.
Clarify only choices that materially alter scope. Keep one writer for overlapping
files; use native subagents only for bounded parallel work or independent review.

OpenSpec is a decision aid for maintained product contracts. Use the project lifecycle
skills to explore, propose, update, apply, synchronize, verify or archive an applicable
change. Routine fixes, dependency refreshes, refactors, documentation, releases and
upstream synchronization do not require a new proposal. Invoke the pinned CLI with:

```bash
bun run spec -- status --change <name> --json
bun run spec:check
```

When implementation changes a current contract, source map or operational procedure,
update the affected spec, knowledge-map row, foundation guide or runbook in the same PR.
Every significant change also updates the relevant current user or contributor
guides in the same PR: features for changed controls and their detail, the
tutorial only when a learner's steps change, README for first-run behavior, and
deployment/packaging for operational changes. Name
these updates in the handoff, or explain why existing guidance stays accurate.
A changelog entry alone does not cover usage instructions. Follow
[documentation maintenance](../AGENTS.md#documentation-maintenance), including
the site build for tutorial changes.

New foundation modules need an owner and focused evidence in the guide. Leave
machine- and user-specific data untracked and use synthetic examples in tests.

### Worker PR handoff template

After committing the complete candidate, save the final PR description to a local
file and run `bun run check:pr-body <file>` before `gh pr create --body-file <file>`.
The same file must be used for both commands. The check validates CI's knowledge-map
and changelog policies against committed HEAD; append the base ref for a stacked PR.
Use this delivery step in worker briefs:

```text
- Prepare the final PR description in a local file after committing.
- Run `bun run check:pr-body <file>` and fix any policy failures.
- Open one ready PR with `gh pr create --body-file <file>` and all required
  labels set at creation. Preserve independent review and do not merge.
```

CI and pre-push share a tooling-only allowlist: `scripts/agent/**` (the worktree helper)
and its tests, this guide and `changes/<slug>.md`. Every changed path in the complete PR must qualify; renames
include both paths. This mode runs the full static lane and affected unit tests,
including all source type checks, and skips World browser suites, behavioral
verification and native installation work. `Delivery checks` and the protected
macOS reports still run. Other classified changes run their affected contracts and consumers under the
shared selection rules, with pre-push limited to non-browser units; unknown paths and every main push keep the full matrix.
Unit/web tests use two CI runners, behavioral models three groups with complete
source-bound aggregation. Model-free owners use affected consumer tests and the
cheap coverage inventory check. Contributor/skill Markdown and browser shard-table
edits avoid the full matrix; executable gate policy and every main push keep it.
Metadata events can reuse a passing scoped run only with the same ordered
selection and exact PR/base/head; missing proof validates afresh.
World and model shards balance measured work; TownCanvas's 22 cases span five
files with the same harness. See [the CI guide](ci-pipelines.md#shared-suite-plan-and-sharding)
for timing sources and evidence boundaries. No CI test asserts a wall-clock budget (the World
latency trend reports timing without gating).
Leaf failures are visible before `Delivery checks` finishes. See [pipeline ownership](ci-pipelines.md) for result requirements.
Fetch main before pushing: `check:size` evaluates the proposed merge against
main's ceilings, allowing an unchanged branch behind main and rejecting restored
ceilings or merge conflicts. For a stacked PR, use
`bun run check:size origin/main <target-ref>` or set
`HERDR_WORLD_RATCHET_TARGET=<target-ref>` for pre-push. CI uses its exact PR base.

### Post review results

Put an explicit sender claim and reviewed commit before the RESULT line in
each formal GitHub review or confirmation comment:

```text
Reviewer: rev2
Reviewed commit: cccccccccccccccccccccccccccccccccccccccc
RESULT #7: 2/2 resolved, 0 new
```

Use the actual PR number and exact reviewed SHA. Reviewer names are numbered
(`rev2`) or named seats (`rev-opus`, `rev-astra`). A named seat counts only on
the `Reviewer:` line. The name is a sender claim,
not a verified identity; the shared GitHub account cannot distinguish crew
reviewers. Legacy headers such as `rev2 — Review of <SHA>` and
`rev1 refreshed confirmation at <SHA>` remain readable. Conflicting reviewer
claims, quoted replies and fenced examples cannot establish a reviewer.

World uses formal review commit metadata or an explicitly named full SHA or
unique prefix; conflicting claims and ambiguous prefixes stay unknown. It
never derives the reviewed head from timestamps. A historical RED/GREEN SHA
mentioned in findings or comparison prose does not claim the reviewed head and
cannot contradict formal review metadata or the canonical header.
RESULT-only evidence remains
separately linked as unknown attribution; a later named review does not claim
an earlier anonymous post. Correct the original post to attribute it. Positive
open-finding counts take precedence over clear or unknown wording, and an
unrecognised remainder cannot make a resolved fraction confirm readiness.
PR actions remain in the browser's confirmation flow, outside the World CLI,
skills and MCP.

### Reach the owner with an ask

To reach the owner, use `herdr-world ask` from your own Herdr pane; no other
channel.
Do not prompt the owner's seat, send Herdr custom notifications, change shared
runbooks or configuration, or post an issue comment as a substitute for asking.
Record the question, then move on or wait for its answer:

```bash
herdr-world ask "Which design should I use?" --owner-only --wait
herdr-world ask "Task 7 has no PR after an hour. What next?" --key dispatch:7:stuck --owner-only --json
herdr-world ask get q-example --wait --json
herdr-world ask withdraw q-example --json
herdr-world ask withdraw --key dispatch:7:stuck --json
```

A new question is committed to the instance's `world.sqlite` with its attention
outbox entry. The service then alerts the owner through the captured Herdr
connection (`notification.show`, sound `request`): Herdr's toasts, every World
connected to that Herdr and Web Push. The JSON reply's `recorded` field says
whether World recorded it and `notified` what Herdr reported (`null` when a
repeated `--key` returned the recorded question without a new alert); both stay
on the final `--wait` reply. Exit 6 (`not_delivered`) means World recorded the
question but no alert was confirmed yet. `retrying: true` means the service
will retry a temporary failure with bounded backoff; an eventual alert may still
arrive. Closing the ask cancels a pending alert. A failure to record retains the
CLI's fallback through the asking pane's Herdr, names the recording failure and
exits 1. A lost service reply can therefore produce duplicate owner alerts.
Report failures once; do not add a caller-side retry loop. Interrupted owner
alerts retain `uncertain` evidence and may retry because duplicate alerts are
harmless. Inspect `ask get ID --json` for the actual evidence. An answer is
durable before acknowledgement and remains retrievable with `ask get` or
`--wait`, including after a restart. Always save the question ID.

New asks from a verified local Linux CLI caller can also receive their saved
answer in the original supported Chat session without `--wait`. World captures
the verified connection, terminal and session binding when the ask is created;
it never learns a replacement recipient later. An offline host waits for that
same binding to be checked on return. A changed or ended session records not
sent. Asks created before binding capture was supported, unverified or
unsupported callers and dismissals remain retrieval-only; there is no historical answer backfill. Successful stdout output
by the verified original asker acknowledges the exact answer and observed
attempt. Failed stdout sends no acknowledgement; a lost acknowledgement or a
read/send race can still duplicate output.

A possible pane send is opaque: `uncertain` never automatically replays. Town
Summary's **Outbox** keeps that answer and its evidence reachable without
reopening the question. Only the owner can choose **Send again…**, confirm a
possible duplicate to the same original session, or **Dismiss** / **Cancel send**
while preserving the answer for `ask get`. Sending in progress has no UI
decision. Reception's compact row counts only unconfirmed/not-sent answers to
check; waiting-only work appears in Summary and the host's letter tag. A native
queue receipt does not prove agent reading or execution, and Herdr provides no
operation-key deduplication. See [answer delivery and limits](ask-answer-delivery.md)
and [data and backups](DEPLOYMENT.md#durable-questions-results-and-backups).

`--key` deduplicates a cause for the verified asking occupant, including an
answered cause. Repeat the same key while that cause persists. Save the returned
question ID and withdraw it once the cause clears; a later occurrence may then
create a fresh ask under the same key. Withdrawal is idempotent and restricted
to the original verified connection, terminal and agent session; a replacement
runtime must verify that same session. A withdrawn ask releases `--wait` with a `withdrawn` field and no invented answer;
withdrawal preserves an answer that arrived first. The existing ledger retains
both, and closed questions remain subject to its retention bound. If a creation
reply is lost, `ask withdraw --key CAUSE` recovers the original occupant's
retained ask and withdraws it without creating a question. A repeated answered
key returns its retained answer. Human withdrawal output explicitly names the
withdrawal, including any answer already recorded.

Open asks appear first in the Needs you tab and Town's Summary, named as Town
labels the asking desk. Their agents wait at reception with a quiet **?** until
answered, dismissed or withdrawn, an unverified asker marked as such; **!**
remains urgent blocking and **✓** an unchecked finish. Board and Desk use the
same qualified question mark. A plain shell terminal receives an asking-seat
entry too, without being relabelled as an LLM agent. A new ask uses World's usual chime, toast and OS
notification preferences, with **Open agent** bound to its original terminal and
session. Browser-local ask events also raise the local OS notice when Web Push
is selected. A restarted page reads existing asks without replaying their
announcements; an obsolete socket reply cannot restore a withdrawn ask.

Workers needing an answer use `--wait` in their own pane.

## Limit merge conflict churn

Before parallel changes, identify shared implementation files and keep one writer
for overlapping edits. Recent recurring integration surfaces include the service
entry point, Town canvas, Chat and the file-size exception ledger. A source split
and a feature touching the same code should land in an agreed order; otherwise
the feature must deliberately follow the split's new module boundaries.

Use changelog fragments rather than editing the assembled `CHANGELOG.md`. Bring
an older branch forward once before final verification, inspect the conflicting
paths and preserve both behaviors. Do not repeatedly merge main solely to chase
an unrelated red CI run: first identify the failed leaf job and whether main
shares it. Branch age increases exposure, but overlapping changes cause the
conflict; a very old branch can still merge cleanly when its files are separate.

## Run an optional visible team

For HWF operating guidance, use the repo-local
[Herdr Workflows skill](../.agents/skills/herdr-workflows/SKILL.md).
The repository includes an opt-in
[Herdr Workflows recipe](../.hwf/workflows/agent-delivery.yaml) for two visible
Codex agents. It uses a startup handshake, one implementation pass, independent
diff review, one correction pass, a final review verdict, and the existing
candidate delivery gates. Herdr Workflows is an external operator tool; this
repository does not install it or require it for ordinary development or CI.

Create a clean branch worktree with `bun run agent:worktree -- create` first.
From a Herdr pane in the primary checkout, supply that worktree's absolute path
and a concrete task brief:

```bash
hwf run agent-delivery \
  --input worktree_dir=/path/to/repo/.agents/worktrees/example \
  --input agent_profile=codex \
  --input task_brief='Deliver the requested change and its acceptance criteria'
```

The tracked `.hwf/config.yaml` supplies a generic Codex profile; put local
overrides in ignored `.hwf/config.local.yaml`. The workflow rejects a dirty
worktree or `main`, and its final review must approve before the implementor
commits and pushes. A remaining review blocker stops the workflow for operator
inspection; do not treat a stopped run as a delivered candidate. On successful
delivery, it closes the two agent panes it created and leaves the caller's pane
open. The PR still needs independent approval. This recipe is for PR delivery;
other tasks can use a local-only handoff under the candidate-delivery skill.
OpenSpec is used only when the task meets the repository's contract criteria above.

## Keep agent work bounded

For an independent PR or focused review repair, start a fresh agent session when
the current context is large. Hand off the branch tip, requested invariant,
relevant files, review comments and latest check result; inspect other context
on demand. For changes across async, identity, failure or UI focus boundaries,
review those transitions against the diff and add applicable focused regressions
before the final gate. Match model and reasoning effort to the risk, then assess
quality and correction rate alongside tokens and time.

## Verify and hand off

Add focused regression tests for behavior changes. The repo-local
[candidate-delivery skill](../.agents/skills/candidate-delivery/SKILL.md) gives
the detailed staged formatter, commit, push and local-only gate procedure for
multi-step handoffs and review repairs. Use
`bun run test:browser` when the browser suite answers a specific question, and
`bun run build:site` for site changes.

Run `bun run install-hooks` once per clone. The pre-commit hook checks format and
lint, and the pre-push hook checks the candidate. Code changes get
`bun run check:changed` (static checks and affected non-browser units; browser
and behavioral acceptance run in CI under required `Delivery checks`), and `HERDR_WORLD_PREPUSH=full` runs `bun run check:delivery` instead. A
Markdown-only follow-up may use `bun run check:docs` after this worktree has a
passed code gate on an ancestor, and a push that only merges `origin/main` runs
`bun run check:static` (see CONTRIBUTING for the exact rule). Worktrees share the
same Git hook configuration.

Agents in parallel worktrees share one machine-wide check queue: one browser lane
for both World and other Chrome tests, one behavioral verification lane, and two
light lanes for non-browser units. Static checks bypass the queue, so failures
report without waiting for heavy work. No delivery lane takes the whole machine.
Run browser suites through `bun run test <path>` or `bun run test:browser`, which
queue, rather than a bare `bun test` on a browser file. A queued gate prints
`[queue] <lane> waiting for <worktree> <lane> (pid, since)`. Wait for its result.
Each run clears its lane logs, including skipped lanes, before starting checks.

Direct test runs recognise canonical file and directory paths, including `./`,
absolute paths and symlinks.
Direct runs that may include a browser suite, including the default full test
run and unknown selections, take the browser slot.
Known value-taking flags such as `-t` and `--timeout` do not widen an explicit
file selection; a flags-only invocation still selects Bun's full test run.
Process exit releases both admission and slots through the kernel.

On a machine with a usable GPU, set `HERDR_WORLD_TEST_GPU=1` (for example in the
shell that runs `git push`) so World browser suites render WebGL on the GPU instead
of SwiftShader; each suite then uses a fraction of the CPU. A failed GPU probe falls
back to SwiftShader with one `[gpu]` log line. CI never uses the GPU, so treat a
pixel difference that appears only in GPU mode as advisory and confirm with CI.

Batch independent read-only inspections in one tool turn. Keep `rg` results and
source excerpts bounded, then read more only when needed. The pre-push hook writes
one ignored `.agents/delivery/pre-push.tsv` row per gate with UTC timestamp,
head SHA, exit code, elapsed seconds and gate name. This worktree-scoped file
is a local diagnostic, not durable PR accounting. The hook prints a short
success status; on
failure it prints a concise summary and the path to the complete retained log.
Inspect that log only when needed, preserving the check's exit status. For
review-only work, inspect exact-head CI evidence first. CI uses
`bun run check:docs` for Markdown-only PR diffs and skips the macOS lifecycle
on those diffs. On PR-description edits, a code PR can reuse a successful full
job or an identically selected scoped job on the exact PR/base/head. Missing
or failed proof runs fresh validation for the current scope. The existing three required status names stay in place.
Run a local check only to investigate a specific gap or reproduce a finding; do
not repeat a successful full gate on the same commit. When a command returns a
running session, call `write_stdin` on that session with empty `chars` and
`yield_time_ms: 300000`; wait again only if it actually times out and remains
running. Apply the same rule to `gh run watch`. Do not issue 30-second status
loops or separate `ps`/`gh pr checks` probes while the blocking command is
running. A Codex lifecycle hook cannot intercept `write_stdin`; do not add one
for polling. The reusable [task prompt](agent-task-prompt.md) repeats this rule.

Inspect the final diff and history for unrelated edits, generated output and sensitive
data. Prepare the PR body with available verification and agent execution using the
[PR template](../.github/pull_request_template.md) before creating the PR; use
`unknown` for values not yet available. Include the changelog fragment under
`changes/` (or the `Changelog: none — <reason>` line) before the first push; the
PR number need not be added to it or linked from the PR body. Do not edit the PR
body without need after creation, because an edit starts another CI run. Reuse earlier results only when their relevant inputs are
unchanged.
Open a ready PR and stop before merge.

## Revisit the process

After a batch of roughly five agent-assisted PRs, and during release preparation,
the agent closing the batch compares usage boundaries, model responses,
compactions, elapsed time, repeated full checks and review repairs. Try one
workflow change at a time and keep it only if it saves work without increasing
defects. Update this short guide when a practice is supported; keep detailed
evidence in the relevant PRs, separate from routine startup reading. This
review is not a gate for individual PRs.

The [UI scale browser test timing analysis](ui-scale-test-performance.md) records
the current slow-case measurements and a proposed test-design experiment.
The [World handoff browser test timing analysis](world-handoff-test-performance.md)
records its deadline shortcut, measured saving and scroll-race diagnosis.

### Accepted proposal boundary for a future OpenSpec documentation lane

[Issue #360](https://github.com/IvoryHeart/herdr-world/issues/360) records a
proposal-only policy decision. **There is no classifier or CI behavior change:**
`scripts/ci-reuse-full-check.ts` still excludes all `openspec/` paths from its
documentation lane. Implementing a future exception needs separate authorization.

That future exception may admit only the exact files
`openspec/changes/<lowercase-kebab-slug>/proposal.md` and
`openspec/changes/<lowercase-kebab-slug>/design.md`, alongside the existing eligible
ordinary documentation. It must not admit a whole change directory or nested
paths. Tasks, current or delta specs, archives, configuration and metadata,
verification/Quint, adapters, consumers and code retain full required checks.
Existing protected workflow policy and packaged notices remain protected too.

Mixed or ambiguous diffs fail closed to the full gate, including case and path
ambiguity. Retain `--no-renames` when collecting changed paths: moving a protected
specification into a proposal path must still expose the protected deletion and
select full verification. This accepted boundary does not authorize bypassing
contract or behavioral verification for a planning file that accompanies code.
