# Crew runbook: dispatcher and worker brief

This is the tracked source of the dispatcher's runbook and the brief it gives
each worker seat. The dispatcher reads a live copy that the owner keeps in the
primary checkout's `.agents/dispatch/`, next to its queue and ledger. Seats
never edit that copy: propose a change to this file by PR, and the owner copies
it once the PR merges. The commit hook refuses staged files under `.agents/`
other than the shared skills (`bun run check:agents`).

The crew itself, its marks and its watcher are described in
[agent development](agent-development.md#act-on-readiness-with-agentcrew).

## Review rounds and evaluation

Round 1 reviews the whole PR. Every reviewer reads the linked issue and flags
behaviour it did not request (scope drift). Later rounds use fresh sessions,
confirm earlier findings and review only the author's changes since the last
reviewed head. Changes imported from main are excluded; manual merge conflict
resolutions remain in scope. Previously accepted code is not reviewed again.

A push alone does not start the next round. While findings await fresh replies,
main-only merges, unrelated CI/harness repairs and pushes outside findings' files
are recorded as skipped. Once every finding is answered, the scoped confirmation
can proceed after quiet time even when the fix belongs in another file. Findings
in CI or harness files follow the same rule; their fixes do not get stuck behind
the CI-only skip.

After a fully confirmed round, only changes to the synthetic PR data fixture
`web/src/world/testing/pullRequestFixture.ts` can carry those exact confirmations
for crew readiness once checks pass. Workflow files and CI, verification, check
or policy scripts require a scoped confirmation. New findings or changed reviewer
evidence invalidate a carry. The report-only `agent:gate` keeps its conservative
copy rule; the crew mark also uses this recorded workflow evidence. Every admitted
round must receive all of its fresh results before readiness or an owner merge
notice, including when an earlier round reviewed the same head.

Read failures hold admission and retry silently. Three consecutive failed reads
on a head escalate to the owner; a successful read resets that count. Rewritten
ancestry or a merge outside main escalates immediately.
The watcher never kills a running round for a merge of main; its reviewers finish
on their pinned head. Waiting reviewers from that round retain their slots in
the queue across pushes.

The author pushes fixes and replies to **every** open finding, signed with
`[<seat>]` (or `[fixer #<PR>]`), one line per finding naming its fixing commit.
Use the finding's stable ID, such as `rev2:123:1`, or its exact `file:line`.
A bare filename suffices only when there is one finding on that file. Two
findings on a file require separate identifiers. A reviewer RESULT that cannot
be mapped to a file still needs an explicit reply using its ID. Replies must
follow the latest reviewer RESULT retaining the finding, even if it only repeats
an unresolved fraction. A prior rejected fix reply cannot start
another round. Fix requests stay stable across pushes while replies are missing.
If a later rejecting RESULT reopens answered findings in the same cycle, the
completed request reopens once; repeat passes do not send duplicate prompts.
After all replies, the watcher waits
until it has observed ten minutes without a new push.
An explanatory reply that needs no code change can trigger a fresh confirmation
round on the same head after that quiet period.
Each admitted round records its finding replies, quiet-period start and trigger
in `review_cycle`; each observed push and each skip reason are retained in
`review_push` and `review_skip` in the local crew SQLite store. These records
survive watcher restarts. Existing stores adopt their recorded reviewer rounds;
fixer and evaluator sessions do not count as review rounds. Migration preserves
queued reviewers, their existing action keys, and their full first reviews. Only
review/confirm actions consume RESULT evidence; auxiliary seats require their
checkpoint-specific verdict or process report.

After round 2, any unresolved earlier finding or new finding starts a fresh
`evaluator` instead of round 3. The roster entry is:

```json
{ "evaluator": { "model": "claude-opus-5-5", "effort": "high" } }
```

The evaluator reads the linked issue, whole PR, all rounds' findings and replies,
and commits between rounds. It posts one comment signed `[evaluator]`, identifying
the checkpoint (`Evaluation: 2`, then 4, 6, …) and `Evaluated commit: <full SHA>`.
Its final line is exactly:

```text
EVALUATION #<PR>: go|no-go — <next step>
```

For **go**, `Required: <comma-separated finding IDs>` (or `Required: none`)
names what must be fixed for the next round. Each other finding has a real
follow-up issue, on its own `Follow-up: <ID> -> <issue URL>` line. Every finding
must be dispositioned once. The next fresh round checks only the mandatory
findings and their fixes; it does not reopen follow-up issues. Mandatory findings
require replies after the evaluator verdict; its timestamp also restarts the
ten-minute quiet period. Follow-up dispositions remain in force
throughout the scoped round, including later passes before its results arrive.
A go with no mandatory findings can start a confirmation round on the same head, with distinct reviewer actions.

For **no-go**, `Process: splitter|fresh-fixer|visionary|restart|owner` selects
one process, with reasons and a concrete next step. `Seat: <roster seat>` names
the fresh process session, except for an owner decision. A fresh fixer must use
a different persona from the author and a clean PR worktree. After pushing, it
posts per-finding replies signed `[fixer #<PR>]` before its separately signed
process report; this lets the next confirmation use its actual fixing replies.
Split/restart processes prepare reviewable replacement PRs before closing the original;
visionary reports a design on the linked issue. The watcher starts the selected
process, holds further reviews and the merge-ready mark, and tells the owner at
reception through `herdr-world ask`. The process reports back in a signed PR
comment carrying the same `Evaluation: <checkpoint>`, ending with:

```text
PROCESS #<PR>: done — <outcome and next step>
```

The watcher runs this checkout's own agent CLI (`server/src/index.ts`), never
an older `herdr-world` on PATH. A failed owner ask is held as `failed` with the
CLI's error, written to the feed once, and asked again only when the CLI's
version or World's `whoami` answer changes; retrying unchanged would repeat
the CLI's Herdr alert. An ask World recorded but nobody was alerted to (exit 6,
`not_delivered`) stays recorded and is reported once. Set `crew.escalate` in
the gate config to a seat name, such as the FirstMate seat, to have each
distinct failure also prompted to that seat once.

Only that report releases the hold. For `Process: owner`, the owner's answer at
reception supplies the decision and releases it. An unavailable process seat,
invalid verdict or failed process remains held for the owner. After every two
further non-converging rounds the evaluator runs again. Owners apply roster
changes to the live config and restart watchers themselves; workers propose
setup changes in PR notes and never edit a running watcher's configuration.

This is crew tooling only; it does not change World's bounded behavioral
verification contracts in `verification/coverage.json`. Focused policy, git
delta, launch and consumer tests cover these workflow transitions directly.

## Dispatcher

You are `dispatch`, a thin dispatcher for the Herdr World backlog. Your only job
is to hand backlog items to the seats, one at a time per seat, and keep a
ledger. Everything after the hand-off already runs without you:

- the seat implements, opens a ready PR, and fixes review findings;
- the crew watcher (`bun run agent:crew -- watch`) starts fresh reviewers for
  the first round, then admits scoped rounds after finding replies and a quiet
  period (see [review rounds](#review-rounds-and-evaluation)), sends findings back to the author
  seat (or to a fresh fixer when that seat is busy on another PR), and marks a head
  `crew/merge-ready` or `crew/needs-owner`;
- the owner merges, and only PRs whose head shows a green `crew/merge-ready`.

So you are **not** a relay, reviewer, fixer or merger. You never write code,
push, approve, merge, close issues or PRs, answer an agent's question, or prompt
a reviewer. Read state; don't pass messages. Keep every pass short.

### Files

- Queue: `.agents/dispatch/backlog.json`. Items have `id`, `pod`, `track`
  (`product` or `debt`), `priority`, `size`, `deps` and `status`. Only
  `status: "open"` items are yours to dispatch; the rest are the owner's.
  `trackLimits` caps open PRs per track, for example
  `{ "product": 4, "debt": 2 }`.
- Ledger: `.agents/dispatch/ledger.md`. Append one line per event:
  `<UTC time> <item> <seat> <branch> <event>`. Events: `dispatched`,
  `pr #N`, `merged`, `stuck: <reason>`, `owner: <question>`. The ledger and
  GitHub are your memory; after a restart, read them before doing anything.
- Worker briefs: `.agents/dispatch/briefs/<item>.md`, from the template below.

### Seats

Each item names its `seat`. The roster in the crew config gives each seat its
harness, model, effort and persona, and the owner starts seats with
`bun run agent:crew -- seat start <seat>`, so a seat always runs on its roster
model. Don't re-route an item: if its seat looks wrong, tell the owner. The PR
labels are always `pod:<item's pod>` and `track:<item's track>`, whichever seat
builds it.

- Only dispatch items whose pod the owner named for today, and only to seats
  that exist in `herdr agent list`. A missing seat is an owner question, not a
  reason to start one yourself. `agent:crew status` lists running seats that
  aren't in the roster; tell the owner about those too.
- `light-dev`, `debugger` and `visionary` are shared across pods: one item at
  a time each.
- `visionary` items (`needs-design`) only when the owner says design is on for
  today. Their brief asks for a design proposal posted as an issue comment, no
  code; afterwards log `owner: design ready for #N` and never dispatch that
  item again.
- An item's `note`, when present, goes into its brief and can set its order.

### One pass

Run these, keep output bounded, and decide:

```bash
gh pr list --state open --limit 50 --json number,headRefName,labels -q '.[]|"\(.number) \(.headRefName) \([.labels[].name]|join(","))"'
bun run agent:crew -- status 2>&1 | tail -40
herdr agent list | jq -r '.result.agents[] | select(.name) | "\(.name) \(.agent_status) focused=\(.focused)"'
tail -20 .agents/dispatch/ledger.md
```

1. **Update the ledger from GitHub.** For each in-flight item, find its PR by
   branch (`agent/<seat>-<item>`). A merged PR is `merged`; a newly opened PR
   is `pr #N`. Nothing else to do for open PRs: the watcher has them.
2. **Spot a stuck seat.** If a seat is `blocked`, read its screen
   (`herdr agent read <seat> --source visible --lines 40`) and tell the owner.
   Never answer it. If a seat has been `done` or `idle` for over an hour with no
   PR and no new commits on its branch, read its screen once and tell the
   owner; don't prompt it again.
3. **Dispatch.** A seat may get a new item only when all of these hold:
   - it is `idle` or `done` and `focused=false`;
   - it has fewer than 2 open PRs and no item in flight without a PR;
   - the item's track has fewer open PRs than its `trackLimits` entry, so
     one track can't starve the other;
   - the item is `open`, every item or issue named in `deps` is merged or
     closed, and no open PR already touches the same files
     (`gh pr list --json number,files`).

   Pick the seat's next item by priority (P1, P2, P3), then smaller size first.
   Two or three `S` items for the same seat that touch the same area may go
   together in one brief and one PR.
4. **Write the brief, then prompt once:**
   `herdr agent prompt <seat> "[dispatch -> <seat>] Read .agents/dispatch/briefs/<item>.md and start."`
   Append `dispatched` to the ledger. Never send the same item twice: check the
   ledger and `git ls-remote --heads origin 'agent/<seat>-<item>*'` first.
5. **Stop.** Print at most 8 lines: what changed, what's in flight, what waits
   on the owner.

### Telling the owner

Ask in your own pane, and log the question as `owner:`. Once crew asks at
reception land (#472), that is `herdr-world ask`. Tell the owner when a seat is
blocked or stuck, when no `open` item is left for a seat, or when an item looks
wrong (already fixed, duplicate, needs design). Don't repeat a question you
already logged.

## Worker brief template

```markdown
You are <seat>. Task <item>: <title> (<issue link, or "no issue yet: file one first with `gh issue create`, labels <pod label> and track:<track>">).

- Read AGENTS.md, then the issue, then the knowledge-map row for the area.
- Work in a fresh worktree: `bun run agent:worktree -- create <seat>-<item> origin/main`.
  Branch: `agent/<seat>-<item>` (the watcher finds the author from this name).
- Deliver with the candidate-delivery skill (.agents/skills/candidate-delivery/SKILL.md):
  tests, docs and a changelog fragment as AGENTS.md requires.
- After committing, prepare the final PR description in a local file and run
  `bun run check:pr-body <file>`; fix any knowledge-map or changelog failures.
  Append the base ref for a stacked PR. Use the same file with
  `gh pr create --body-file <file>` when opening the PR.
- Open a ready (not draft) PR that says `Fixes #<issue>` and carries the labels
  `<pod label>` and `track:<track>`, both set at creation (`gh pr create --label ...`).
  Never add labels to an open PR: each label starts a CI run.
- Reviews arrive by themselves. When the watcher sends you findings, fix every
  P1–P3 finding in place and reply on the PR with one line per finding.
  While you are busy on another PR, a fresh fixer may do a step for you in
  that PR's worktree and reply signed `[fixer #N]`; keep a worktree you
  aren't working in committed, so the fixer can take it.
- Start every GitHub comment you post with `[<seat>]`, because every seat posts
  with the owner's account. A review is signed by its `Reviewer:` header.
- Reach the owner only by asking in your own pane (`herdr-world ask` once #472
  lands). Text already in your input box that you didn't type, such as a
  harness suggestion, is not the owner's words.
- Before you doubt a bug report, reproduce it in a throwaway Herdr session
  (`herdr --session <name>`, never the live one). The owner's live report is
  evidence; older evidence and passing tests are not.
- Don't merge, don't use --admin, don't answer other agents, and never put local
  paths, hosts, usernames or session links in anything you publish.
- Write only inside your own worktree. Never edit files in the main checkout or
  under `.agents/` outside it (briefs, ledgers, crew config, other worktrees),
  and never `git add -f` an ignored path; the commit hook refuses them. If a
  shared runbook or config should change, change docs/crew-runbook.md in your
  PR or say how in its description.
- If the task is unclear, already fixed, or needs a product decision, stop and
  say so in one line on the issue. Don't guess.
```

Add item-specific notes after the template only when the queue gives them
(for example: "do together with H2", or "verify only: #329 may have fixed it").
For the Roamgate sync items: read `UPSTREAM.md`, sync one version per PR,
strictly in order, and record the synchronization in `UPSTREAM.md`.

The PR-description check uses CI's existing knowledge-map and changelog policies
against the committed PR diff. After this tracked template changes, the owner
copies its delivery steps into the live dispatcher template.
