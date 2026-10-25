# Agent development

Herdr World uses native coding-agent conversations, repository instructions, current
OpenSpec contracts and ordinary project checks. The local `agent:usage` script
reports recorded usage without scheduling agent work.

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
- `check:changed`, `check:delivery`, `test:browser` and the World browser suites
  refuse to start, with a message, when the worktree's filesystem or the temporary
  directory has less than 3 GB free. Set `HERDR_WORLD_MIN_FREE_GB` to change the
  floor (`0` turns it off); CI skips the guard.

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
guides in the same PR: tutorial/features for changed controls or steps, README
for first-run behavior, and deployment/packaging for operational changes. Name
these updates in the handoff, or explain why existing guidance stays accurate.
A changelog entry alone does not cover usage instructions. Follow
[documentation maintenance](../AGENTS.md#documentation-maintenance), including
the site build for tutorial changes.

New foundation modules need an owner and focused evidence in the guide. Leave
machine- and user-specific data untracked and use synthetic examples in tests.

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

### Check readiness with agent:gate

`agent:gate` computes whether a pull request is ready for the owner's merge
from GitHub and git, never from an agent's claim. It is report-only. It never
writes to GitHub, prompts an agent or merges.

```bash
bun run agent:gate -- pass                # read open PRs, record and print verdicts
bun run agent:gate -- explain 7           # receipt with evidence and an escalation packet
bun run agent:gate -- merge-line 7        # re-read #7; head-pinned merge command only when READY
bun run agent:gate -- check-claim 7 <sha> # re-read #7; check a crew "READY #7" message
bun run agent:gate -- hold 7 --reason "owner repro"   # until `release 7`
bun run agent:gate -- waive 7 <source> --reason "…"   # resolve one unattributed RESULT post
bun run agent:gate -- diff                # verdict changes in the latest pass
bun run agent:gate -- replay <dir>        # re-run fixture files; --pass ID re-runs a recorded pass
```

A verdict is `READY`, `NOT_READY`, `WAITING`, `UNKNOWN`, `NEEDS_JUDGMENT`,
`MERGED` or `CLOSED`, and the worst condition decides. The PR card's own rules
decide draft, checks, mergeable and screenshots. Each check is judged by its
newest execution, ordered by Actions job ID rather than finishing time; repeated
runs that can't be ordered are `UNKNOWN`. The PR list's check summary never
overrides a newer failing or running check. The gate adds:

- **Required checks.** The base branch's required checks come from GitHub's
  rules, from classic branch protection when it is readable, and from
  `requiredChecks` in the config. A required check that never ran is
  `UNKNOWN`. So is an unknown inventory: the rules are unreadable or require
  nothing, and the config sets no `requiredChecks`. Set `"requiredChecks": []`
  to declare that none are required.
- **Required reviewers.** Each one's latest claim must confirm a head that
  still counts. Reviewers are set per PR number, else per `pod:<name>` label,
  else a default list.
- **Every other finding.** The gate reads the PR's full review and comment
  history, not the PR card's recent window.
  - Any other named reviewer who ever reported findings must confirm on a head
    that still counts.
  - An unattributed RESULT that isn't a clear confirmation, judged on its full
    text, blocks until its post is attributed or someone records `waive` for
    its source ID, which `explain` shows.
  - Incomplete history is `UNKNOWN`.
- **The copy rule for claims on an earlier head.** A claim carries over only
  when every later commit merges a commit already on main and replaying that
  merge reproduces its tree. Any other commit, including a resolved conflict,
  needs confirmation again. Being behind main never matters.
- **CI attempts.** A check that went green on a rerun keeps its failed
  attempts on record. Only a configured flake within its rerun budget stays
  READY; any other rerun needs judgment.
- **Holds.** A hold lasts across heads until it is released.

`merge-line` and `check-claim` read the PR again before answering, so a hold,
a new finding, a push or a merge since the last pass always counts.
`merge-line` prints `gh pr merge N --merge --match-head-commit <sha>` only for
a READY verdict, so GitHub refuses the merge if the head moves afterwards. It
exits with status 2 otherwise, and never prints `--admin`. `replay --pass`
re-judges a recorded pass with the config it ran with, notes when
`config.json` has changed since, and exits 1 if any verdict differs in state,
head, conditions or notes.

Configuration and state stay untracked in the primary checkout's
`.agents/crew-gate/`, which every worktree shares:

- `config.json` holds the repository, reviewers, flakes, rerun budget and
  optional required checks. Start from
  [`config.example.json`](../scripts/agent/gate/config.example.json).
- `gate.sqlite` keeps every pass's inputs and config, reviewer claims, check
  attempts, decisions and verdict transitions. Comment text is reduced to
  RESULT lines.
- `mirror.git` is a bare mirror of main and pull request heads, so the gate
  never fetches into a checkout.

Source: [`scripts/agent/gate.ts`](../scripts/agent/gate.ts) and
[`scripts/agent/gate/`](../scripts/agent/gate/). The predicate is pure, and its
acceptance cases live in `cases.ts`.

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
Run long commands through `bun run agent:await --log .agents/hwf/check-001.log --
bun run check` (choose a fresh log path). The helper blocks until completion,
preserves the exit code and prints at most 8 KiB plus the full log path. Logs are
local and ignored. Resume a running execution session with its blocking wait;
do not run status probes alongside it. The helper forwards interrupts to its
immediate child and does not clean up agent panes or unrelated processes.

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
`bun run check:changed` (static checks and the affected tests; CI runs the full
gate), and `HERDR_WORLD_PREPUSH=full` runs `bun run check:delivery` instead. A
Markdown-only follow-up may use `bun run check:docs` after this worktree has a
passed code gate on an ancestor, and a push that only merges `origin/main` runs
`bun run check:static` (see CONTRIBUTING for the exact rule). Worktrees share the
same Git hook configuration.

Agents in parallel worktrees share one machine-wide check queue: one browser lane
and one behavioral verification at a time, two light lanes, and the timed
(latency) lane alone on the whole machine. Run browser suites through
`bun run test <path>` or `bun run test:browser`, which queue, rather than a bare
`bun test` on a browser file, which does not. A queued gate prints
`[queue] <lane> waiting for <worktree> <lane> (pid, since)`. Do not bypass the
hook because a gate is queued; the wait is shorter than the contention it avoids.

Direct test runs recognise canonical file and directory paths, including `./`,
absolute paths and symlinks. A pending whole-machine lane reserves admission before
waiting for running work, so later ordinary arrivals cannot continually overtake
it. This reserves admission before heavy slots drain: light work also waits,
even with free light slots, and can wait minutes behind a running heavy lane.
Direct runs containing timed suites take every slot, including the default
full test run and `test:world --shard=latency`. Unknown selections conservatively
take the quiet lane; known browser-only selections take the browser slot.
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
on those diffs. On PR-description edits, a code PR can reuse successful full jobs on
the exact base and head; if that proof is missing or failed, CI runs the full
gate. The existing three required status names stay in place.
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
PR number need not be added to it or linked from the PR body. Keep later usage accounting in the workflow output and final handoff
instead of editing the PR body solely for totals, because an edit starts another
CI run. Reuse earlier results only when their relevant inputs are unchanged.
Open a ready PR and stop before merge.

`agent:usage` remains available for [optional Codex usage audits](agent-usage-audit.md).
Do not make agent-run token accounting a routine pre-PR step. The measurement
follow-up owns durable task/session/PR-linked usage collection; local rollout
records are interim evidence.

## Revisit the process

For the next comparable task, the process review measures wait-only model turns
per six-minute gate from the Codex rollout; formatter writes per candidate from
`format:staged` output and the rollout; full checks per pushed candidate and
check wall time from the pre-push hook and CI run metadata; and review
outcomes from the PR timeline. A durable workflow artifact must join these
records to the task, session, PR and candidate head before the worktree is removed.
Add ingestion or upload for the local hook report in that measurement follow-up;
the ignored TSV alone is insufficient. `agent:usage --tooling` cannot count a check
executed inside the pre-push hook as a literal agent command. The first targets
are at most two blocking waits per six-minute gate and one formatter write per
candidate. Keep measurements in workflow artifacts and the process review; do
not edit a PR body later solely for these totals. Targets do not replace gates.

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
