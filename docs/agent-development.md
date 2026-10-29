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

The dispatcher uses this [tracked worker template](crew-runbook.md) for its PR
handoff. Live dispatch files remain local; the owner updates them from the tracked
instructions after merge.

CI and pre-push share a tooling-only allowlist: `scripts/agent/**` and its tests,
this guide, `docs/crew-runbook.md`, `docs/dispatch-runbook.md` and
`changes/<slug>.md`. Every changed path in the complete PR must qualify; renames
include both paths. This mode runs the full static lane and affected unit tests,
including all source type checks, and skips World browser/latency, behavioral
verification and native installation work. `Delivery checks` and the protected
macOS reports still run. Other code paths keep the full CI matrix, as do all main
pushes. See [pipeline ownership](ci-pipelines.md) for result requirements.
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
newest execution: within one workflow, the higher run number and then the
higher attempt, never the job ID or finishing time. Repeated runs that aren't
all known executions of one workflow are `UNKNOWN`, and the worst of them
stands. The PR list's check summary never overrides a newer failing or running
check. The gate adds:

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
- **Aggregate checks.** Name roll-up jobs that only summarise other jobs in
  `aggregateChecks`; they are never inferred. A named aggregate's failed
  attempt is excused only when every other check that failed in that same run
  attempt is a listed flake within its budget whose newest run passed; a
  skipped or missing recovery doesn't count. If the aggregate failed alone,
  beside any other failure, or in an attempt the gate can't place, it needs
  judgment. A named aggregate is never treated as a flake, and the config is
  refused if a check appears in both lists.
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
  optional required and aggregate checks. Start from
  [`config.example.json`](../scripts/agent/gate/config.example.json).
- `gate.sqlite` keeps every pass config and replay input, reviewer claim,
  check attempt, decision and verdict transition indefinitely. Identical input
  bodies share one stored payload, while each pass keeps its own reference and
  freshness timestamps for replay. By owner decision, the gate retains this
  development history indefinitely and does not delete it by age. A manual
  history-clearing affordance is deferred. Comment text is reduced to RESULT
  lines. `agent:crew status` reports the combined SQLite database, WAL and
  shared-memory file size.
- `mirror.git` is a bare mirror of main and pull request heads, so the gate
  never fetches into a checkout.

Source: [`scripts/agent/gate.ts`](../scripts/agent/gate.ts) and
[`scripts/agent/gate/`](../scripts/agent/gate/). The predicate is pure, and its
acceptance cases live in `cases.ts`.

### Reach the owner with an ask

To reach the owner, use `herdr-world ask` from your own Herdr pane; no other
channel. The watcher, dispatcher and workers use the same World question ledger.
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

`--key` deduplicates a cause for the verified asking occupant, including an
answered cause. Repeat the same key while that cause persists. Save the returned
question ID and withdraw it once the cause clears; a later occurrence may then
create a fresh ask under the same key. Withdrawal is idempotent and restricted
to the original verified connection, runtime, terminal and agent session. A
withdrawn ask releases `--wait` with a `withdrawn` field and no invented answer;
withdrawal preserves an answer that arrived first. The existing ledger retains
both, and closed questions remain subject to its retention bound. If a creation
reply is lost, `ask withdraw --key CAUSE` recovers the original occupant's
retained ask and withdraws it without creating a question. A repeated answered
key returns its retained answer. Human withdrawal output explicitly names the
withdrawal, including any answer already recorded.

Open asks appear first in Town's Needs you rail and Summary, named as Town
labels the asking desk. Their agents wait at reception with a quiet **?** until
answered, dismissed or withdrawn, an unverified asker marked as such; **!**
remains urgent blocking and **✓** an unchecked finish. Board and Desk use the
same qualified question mark. A plain watcher terminal receives an asking-seat
entry too, without being relabelled as an LLM agent. A new ask uses World's usual chime, toast and OS
notification preferences, with **Open agent** bound to its original terminal and
session. Browser-local ask events also raise the local OS notice when Web Push
is selected. A restarted page reads existing asks without replaying their
announcements; an obsolete socket reply cannot restore a withdrawn ask.

The watcher runs from its own pane, records asks without blocking a pass, and
reads an answer back once into that pane's output and the crew feed. Pending
creation/recreation receipts survive supersession, so a cause clearing after a
lost reply still withdraws its persisted question by key. A withdrawal whose
reply was lost permits a fresh question when the same cause recurs, even after
its answer was read. Withdrawal uncertainty is saved before dispatch and settled
before recreating the cause. Holds and scope changes preserve these receipts and
answer acknowledgements. Historical superseded notices without receipts are
ignored; keyed cleanup that finds nothing reports “no recorded ask to withdraw”,
without claiming the earlier question was withdrawn. If the original occupant
can no longer withdraw (for example after a runtime-generation
change or a restart in another pane), the watcher retires the cleared cause and
records once in the feed that the question is left for the owner to answer; it
does not retry that permanent refusal. Transient failures still retry. When the
owner dismisses an ask, the watcher records that once in the feed and does not
ask again while the cause holds; it withdraws the ask when the cause clears.
The watcher's asks use `--key`, which the service refuses to an unverified
caller, so run it in a Herdr pane with `herdr-world` reaching the service's own
port, never a dev proxy such as Vite's. It never
routes an answer to a different seat. Workers needing an answer use `--wait` in
their own pane. Deploy the matching World service and CLI before restarting the
watcher from the merged checkout. Dispatcher runbook changes are applied by the
owner after merge, as described in the PR handoff.

### Act on readiness with agent:crew

`agent:crew` is the crew watcher. Agents coordinate through the state on GitHub,
not by messaging each other. Each pass reads the open PRs through `agent:gate`,
plans the next step for every PR in scope and takes each step once:

| Gate state | Step | Who |
|---|---|---|
| Findings are open on the head and every required reviewer has posted on it | One `ACT #N fix` prompt with the review URLs, so the author fixes in one pass | The author's seat |
| A required check fails and no check is still running | `ACT #N ci` prompt | The author's seat |
| GitHub reports a conflict, or screenshots are missing | `ACT #N conflict` or `ACT #N screenshots` prompt | The author's seat |
| A fix, ci or conflict step is due and the author seat is busy with another PR | A fresh fixer run in the PR's own worktree | The author seat's roster model |
| A required reviewer has no RESULT, or a newer head needs confirming, and GitHub reports the head mergeable, whatever its checks | A fresh reviewer run | That reviewer's model |
| READY, with every required reviewer confirmed on the head | The `crew/merge-ready` mark and a World ask with the PR and reason | The owner |
| A judgment condition, an unknown author, an unsupported roster model, a stuck author seat or a reviewer run that posted nothing | The `crew/needs-owner` mark, one signed `[crew]` state comment and one World ask per distinct cause | The owner |

- **Merge only `crew/merge-ready`.** The watcher marks a PR's head with two
  commit statuses, shown with its checks on GitHub:
  - `crew/merge-ready` is green when the head is READY and has had at least
    one review round: at least one required reviewer, every one of them
    confirmed on this head, required checks green, not draft, mergeable and
    screenshots present where required. A PR no reviewer has finished never
    gets it. If that stops holding on the same head, as with a hold or a new
    finding, the next pass sets it back to pending. A push leaves the mark on
    the old head, so a new head is unmarked until it is READY again.
  - `crew/needs-owner` is pending while the watcher waits on the owner for
    the PR: a CI judgment after reruns, an unknown author, a stuck or missing
    author seat, or a reviewer run that ended without a RESULT. Each cause
    also gets one comment signed `[crew]` saying what it needs, with local
    paths left out. That comment describes PR state; the World ask carries the
    owner's question. The mark turns green ("Nothing waits on the owner") once
    every cause clears.

  Only the watcher sets these marks. They are commit statuses rather than
  labels because every label starts a CI run (`ci.yml` runs on `labeled`),
  and they are not checks: the gate, World's pull request list and card, and
  the workspace's check summary leave `crew/*` statuses out, so a pending mark
  never holds a green head back.
- **Who the author is.** The branch names the author: `agent/<seat>-…`, or the
  pod lead for `batch/<pod>-<n>`. Set an override per PR in `authors`.
- **When a seat gets a prompt.** Only when Herdr reports it idle or done and
  it isn't focused, because a prompt types into the seat's input box. Other
  steps wait for a later pass, or go to a fresh fixer (below). Seats listed in `neverPrompt` are never
  prompted; the owner gets an ask instead.
- **How reviewers run.** Each review or confirmation is a fresh, interactive
  `claude` (in auto permission mode) or `codex` session on the seat's roster
  model, in a detached
  checkout of the exact head, with its brief as the first message. The brief
  gives references to the work item. The owner watches it work in the
  harness's own interface and can type to it at any time, as with any agent
  in Herdr. It posts one review with the canonical header. The review is done
  once that RESULT is on GitHub: the watcher then records the result and the
  token usage (read from the harness's session files) and frees the slot. The
  session stays open in its pane as a chat. A confirmation reviews the delta
  from that reviewer's last claimed commit. At most `maxRuns` reviewers work
  at once. One that is still working after `runTimeoutMinutes` without posting
  is reported to the owner, not stopped. A session that crashes before
  posting is retried once. One that is quit, or exits cleanly, without a
  RESULT on the head goes to the owner after 15 minutes. A post without a
  RESULT line doesn't count. A RESULT counts for the head it was given, even
  if the session has ended or a newer head has arrived since.
- **Where reviewers show.** A PR is a pod, and each head it reviews is a
  round. A round has its own Herdr tab, named like `#7 towncx-12-plates · r2`,
  with one pane per reviewer, named after the reviewer. Every reviewer stays
  in its pane until the PR merges or closes, so the owner can read and
  question every round before merging. Only a reviewer still working when a
  newer head arrives is stopped, since its review is stale; its pane says so
  and gives the command to reopen it. If you quit a session yourself, its pane
  gives the same command. A tab the owner closes is reopened for that round's
  next reviewer, and every tab a round used closes with it. If Herdr or git
  can't finish that cleanup, the round stays open and the next pass retries
  it.
- **Reopening a run.** Each run records its harness, model, session and
  RESULT. `open` resumes a session that has ended (one still open is in its
  pane), on the run's own model, as
  an interactive chat in a new Herdr tab. It runs from the reviewer's checkout,
  which `open` recreates if it's gone. There you can read the whole review and ask the
  reviewer about it; it uses tokens only when you type. A chat tab closes with
  its round, and only then is its checkout removed. `open` waits for a running
  pass, so a merge can't land between opening a chat and recording it. A chat
  opened after the PR has closed removes its checkout when you exit it. Until
  then, `open` refuses a second chat on that run.
- **Review on push.** Reviewers read the diff, not CI results, so a round
  starts as soon as a new head is pushed and GitHub reports it mergeable, in
  parallel with its checks: with busy passes, within about a minute of the
  push. A failure still goes to the author as a `ci` step once the checks
  settle, and a CI rerun the owner has to judge still asks them. READY and
  `crew/merge-ready` still need green checks, any judgment and the reviews.
- **A fresh fixer for a busy author.** A seat works on one PR at a time, so
  when a PR's `fix`, `ci` or `conflict` step is due and its author seat is
  working (or blocked) on another PR, the watcher starts a fresh fixer
  instead of waiting. It runs like a reviewer: a fresh, interactive session
  on the author seat's roster model and harness, in a pane of the PR head's
  round tab named `<seat> fixer`, briefed with the steps' messages, the PR and
  the candidate-delivery skill. It works in the PR's own worktree, pushes to
  the PR branch through the normal pre-push gate and replies on the PR in one
  comment signed `[fixer #N]`. It is done when the watcher sees a new head
  that its worktree is at (its own push), or when it runs the `fixed --run N`
  command its brief gives, as after rerunning a flaky job without a push.
  Its session then stays open as a chat, and `open --run` reopens it in that
  worktree, under the pass lock. A fixer overtaken by someone else's push, or
  whose PR merges or closes, is stopped like a stale reviewer.
  - **Only on evidence that the author is elsewhere:** the seat's latest crew
    prompt was only about other PRs. One prompt carries every waiting step,
    so a prompt that included this PR means the author may be on it. A seat
    the crew has never prompted keeps its steps too.
  - **Only where it can't clash:** the step also waits for the author when the
    PR's worktree is missing, has uncommitted changes or isn't at the PR's
    head, the seat has no roster model, or no run slot is free.
  - **One at a time:** at most one fixer works on a PR, and each head gets
    one. While it works, the PR's other author steps wait for it; a fixer
    that ends without being done leaves its steps to the author. Fixers count
    against `maxRuns` and `runTimeoutMinutes` like reviewers; screenshots stay
    with the author. A Codex fixer's session is the one created after it
    started, not the author's older one in the same worktree.
- **What stops a step.** Only a newer head, a merge or a close supersedes a
  waiting step or stops a running reviewer. On the same head, a CI rerun or
  an unknown mergeable state only pauses steps; they resume when the head is
  eligible again. A reviewer that has just posted finishes its run. A PR
  reopened on the same head is planned afresh.
- **Parking a PR.** Add the `on-hold` label, or `agent:gate hold`, to leave a
  PR visible to the watcher while it plans no new prompts, reviewer runs or
  owner notices for it. Its waiting steps are retired, as are those of a PR
  that leaves the watcher's scope, so `status` doesn't list them; a reviewer
  already working finishes. Remove the hold to resume on the next pass, which
  plans the steps again. `status` lists held PRs as last read: the latest pass
  over every PR, updated by the busy passes since.
- **Which checks count.** An attempt that a later attempt of the same
  workflow replaced, as a rerun does, doesn't count. Same-name checks from
  runs the gate can't order, such as two workflows, all count: the gate keeps
  only the worst of them, but none has replaced another. The author gets a
  failure's `ci` step once no counted check is still running, so a failure in
  one workflow waits while a same-name job in another is still running. The
  step's message summarises the failures (the first three names, then an
  ellipsis); its key covers every counted failed job, so a new failure among
  them sends a new step.
- **A check that never finishes.** GitHub sometimes loses a finished job's
  status, and the check then shows as running for good, which holds every
  review back. The watcher notes when it first sees each counted check
  running. One still running after `stallMinutes` (default 30) goes to the
  author as a `ci` step, with the `gh run rerun --job` command for it, or to
  the owner once if the PR has no author seat. `pass --dry-run` shows these
  too, without recording anything.
- **When a step repeats.** A CI step is keyed by the failed jobs, so a rerun
  that fails again prompts the author again. Every owner notice is an action
  of its own: READY, NEEDS-OWNER, a seat that is missing or never prompted,
  a blocked seat and a seat that keeps refusing prompts. Each records one
  keyed World ask, retried if the service is unavailable. Answered causes stay
  acknowledged until they clear. The watcher withdraws both pending and already
  sent asks when their causes clear, including same-head readiness changes,
  seats resuming, new heads, PR closure and an on-hold label. Scoped passes leave
  other PRs' asks alone.
- **How often it looks.** `watch` reads every open PR once every `--interval`
  seconds (300 by default), counted from the start of one pass to the start
  of the next, so a slow read doesn't stretch the gap. In between, it reads
  only the busy PRs every `--busy-interval` seconds (60 by default). A PR is
  busy while a check runs, a step is open (such as a reviewer at work) or it
  is READY and may be merged. A busy pass takes seconds, so a green check, a
  posted review or a merge is acted on within about a minute. Set
  `--busy-interval` to the interval to turn busy passes off.
- **Where the owner reads it.** Every plan, prompt, run and notification is a
  line in `.agents/crew-gate/feed.log`, so the owner can follow the crew
  without any agent spending a turn on it.

```bash
bun run agent:crew -- pass --dry-run   # print the plan; change nothing
bun run agent:crew -- watch            # every PR each 300 s (--interval), busy PRs each 60 s (--busy-interval)
bun run agent:crew -- status           # held PRs, open steps, recent runs, reviewer tokens per PR, pod and track (--hours 24), unrostered seats, a stale watcher
bun run agent:crew -- seat start dispatch   # start a roster seat on exactly its harness, model, effort and persona
bun run agent:crew -- feed             # the last lines of the crew feed
bun run agent:crew -- runs --pr 7      # each run's round, RESULT, tokens and open command
bun run agent:crew -- open --run 12    # reopen a run as a chat (or --pr 7 --reviewer rev2 --round 2)
bun run agent:crew -- review --pr 7 --reviewer rev2 --head <sha>   # one fresh reviewer now
```

Settings go under `crew` in the gate's `config.json`:

- `pods` limits the watcher to PRs labelled `pod:<name>`; empty means every PR.
- `prs` adds PRs regardless of their labels.
- `leads` maps each pod to its lead seat.
- `authors` holds per-PR author overrides.
- `neverPrompt` lists seats the watcher never prompts.
- `maxRuns` (default 3) bounds the reviewers working at once, and
  `runTimeoutMinutes` (default 90) is when one still working without posting
  is reported to the owner. `stallMinutes` (default 30) is when a check still
  running counts as stuck.
- The gate config's `roster` gives each seat its `model`, `effort` and,
  optionally, `harness` (`claude` or `codex`; by default the one that runs the
  model) and `persona` (its standing instructions, passed as Claude's appended
  system prompt or Codex's developer instructions). Reviewers run on it, and
  `seat start` launches every other seat from it.

`crew.sqlite` records each step once under a key built from the PR, head, kind,
target and, for CI and judgment steps, their cause. A repeated pass or a
restart never prompts twice. Only one pass reads and acts at a time. It holds
`crew.lock` from its GitHub read to its last step, and the OS releases the lock
if the process dies. A second watcher or an overlapping `pass` waits, then
reads after the first has acted. Each step is committed as soon as it happens,
so a crash never forgets a prompt that was already sent. A scoped `pass --pr`
acts only on the PRs it read. Run logs are kept in `runs/`. On GitHub the
watcher only sets its two `crew/*` marks and posts its signed `[crew]`
comments; it never pushes, merges or approves, and the fresh reviewers post
their own reviews.

### Seats, spend and guardrails

- **Pinned seats.** Start a seat with `agent:crew -- seat start <seat>`. It
  opens a Herdr tab in the primary checkout and starts the seat as a named
  Herdr agent on exactly its roster entry: Claude in auto permission mode,
  Codex with the owner-approved full access the crew runs with. A seat started
  by hand with an omitted model flag runs the harness default instead, which is
  how a Haiku dispatcher once ran Opus all session. `status` names running
  seats that aren't in the roster, and `seat start` refuses a seat that is
  missing from it or already running.
- **Tracks and spend.** Issues and PRs carry `track:product` or `track:debt`
  next to `pod:<pod>`, both set when the PR is opened (a label added later
  starts a CI run). `status` sums reviewer tokens over the last `--hours`
  (default 24) per PR, pod and track: Codex's total, or Claude's input, output
  and cache tokens. The dispatcher caps open PRs per track, so one track can't
  starve the other.
- **A watcher on old code.** A running watcher keeps the code it started
  with: the crew, the gate and every module they import, such as the shared
  pull request rules and the server's GitHub readers. Each pass compares that
  with the files in the watcher's checkout; when a merge changes any of them,
  the owner is told once to restart the watcher (a notice Herdr didn't show is
  retried), and `status`, run from any checkout, names each running watcher
  that is behind its own checkout. Each watcher keeps its versions under its
  own process ID and start time, so watchers in different checkouts don't
  mix; it removes that record when it stops, and each pass forgets the record
  of any watcher that no longer runs. A process that later gets the same ID,
  even after a reboot, has another start time and is never taken for it.
- **Guardrails.** The dispatcher runbook and the worker brief template are
  tracked in [the crew runbook](crew-runbook.md); seats change them by PR, never
  the live copy in `.agents/dispatch/`. The commit hook (`check:agents`) refuses
  staged files under `.agents/` other than the shared skills, so a force-added
  live file can't be committed. Every GitHub comment a seat or the watcher
  posts starts with `[<seat>]` (the watcher signs `[crew]`; a review is signed
  by its `Reviewer:` header), because every seat posts with the owner's
  account. A seat reaches the owner only by asking in its own pane, treats text
  it didn't type in its input box as not the owner's, and reproduces a bug
  report in a throwaway `herdr --session` before doubting it: the owner's live
  report is evidence, passing tests are not.

Source: [`scripts/agent/crew.ts`](../scripts/agent/crew.ts) and
[`scripts/agent/crew/`](../scripts/agent/crew/).

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
(latency) lane alone on the whole machine. Within that lane, the delivery gate
runs timed World browser files serially, matching CI’s latency shard while
preserving each fixture’s concurrent-context checks and deadlines. Run browser
suites through
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
PR number need not be added to it or linked from the PR body. Keep usage accounting
in one marked PR comment, created when READY and edited
in place at merge. Do not edit the PR body solely for totals, because an edit
starts another CI run. Reuse earlier results only when their relevant inputs are
unchanged.
Open a ready PR and stop before merge.

`agent:usage` records [per-PR usage](agent-usage-audit.md) from local Codex and
Claude Code sessions. Register builder/fixer assignment windows locally, then run
`bun run agent:usage comment N --post` when the PR is READY and again at merge.
This accounting is routine at those milestones, but is not a pre-PR gate. Full
rows stay in the ignored `.agents/crew-gate/usage.sqlite` in the primary checkout;
the one `<!-- crew-usage -->` comment contains aggregate role/model totals and
measurement caveats. Session IDs, paths and other private identifiers never belong
in the comment or PR body. Preserve unattributed usage and label coordinator
heuristics as estimates. Run `bun run agent:usage roster-check --pr N` to compare
recorded models and efforts against the shared config roster. The public comment
includes model-only drift notes; unknown effort remains unknown. Quarantined
Claude records retain valid usage and contribute a partial-measurement caveat.
The original bounded Codex audit and `--tooling` remain available for investigation.

## Revisit the process

For the next comparable task, the process review measures wait-only model turns
per six-minute gate from the Codex rollout; formatter writes per candidate from
`format:staged` output and the rollout; full checks per pushed candidate and
check wall time from the pre-push hook and CI run metadata; and review
outcomes from the PR timeline. A durable workflow artifact must join these
records to the task, session, PR and candidate head before the worktree is removed.
The PR usage ledger records tokens and attribution; ingestion of the local hook
report into durable gate measurements remains a separate follow-up. The ignored
TSV alone is insufficient. `agent:usage --tooling` cannot count a check
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
