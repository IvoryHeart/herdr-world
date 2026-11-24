# Agent development

Herdr World uses native coding-agent conversations, repository instructions, current
OpenSpec contracts and ordinary project checks. Agent work is dispatched by the separate herdr-crew dispatcher; this repo only defines how code is built, tested and delivered.

## Find a feature

Start with `openspec list --specs --json` for capabilities and
`openspec list --json` for work in progress. Use `openspec show <id>` to inspect
one. For example, read `world-surfaces/town`'s `spec.md` and `notes.md`, plus any
relevant active change, to find quiet-agent contracts, preference storage and
Town drawing.

Read the capability's spec and `notes.md`, and inspect every listed surface: Town,
Board, Spaces, Inspector, CLI, phone/desktop and both runtimes where named. Search
all documentation matches without `-m`. Contracts live only in OpenSpec. Notes
contain surfaces, owning Code paths, tests, pitfalls and usage reference. Code paths
are repository-relative exact files, directories ending in `/`, or globs. The PR
check rejects each added or modified source file with no matching capability Code path.
Existing subsystem directories have owners; new unowned subsystems must add one.
Deleted paths no longer need an owner.

The retired knowledge map has no replacement file. `FEATURES.md` is ignored and
generated from specs and usage notes by `bun run build:site`, alongside the public
`/features/` page. Edit capability notes or learner steps in `docs/TUTORIAL.md`.
Use the [foundation guide](foundation-guide.md) for cross-module data flows.
Repository rules and worktrees live in [AGENTS.md](../AGENTS.md); the helper
rejects unsafe names and unknown refs. `bun run agent:worktree -- list` is read-only.

Feature PRs add or update one `openspec/changes/<slug>/` with requirement deltas,
the implementation and capability notes. Update the notes' Code list in that
same PR, including new storage and rendering paths, while its contract delta is
still active; do not wait for archival. Existing broad directory ownership proves
source coverage, not that a feature's navigation is current. Do not edit current
`spec.md` files.
A main push queues one `bot/openspec-archive` PR: completed changes are applied
and archived oldest merge date first; incomplete tasks stay active. A conflict
restores that item's partial writes and stops the batch, retaining earlier
successful archives in the PR. Even an empty stopped batch fails the workflow and
names the stopped change in its log and summary. Each run recreates the bot
branch from current main, so an older batch never conflicts with later merges;
resolve the named delta in a normal PR, as a repair on the bot branch is replaced
by the next run. When main has nothing left to archive, the run closes an open
batch PR. Merge dates use first appearance on main, independent of timezone
or later edits. The bot never pushes main or merges; independent review still applies.
The pinned CLI has no bulk command, so `scripts/archive-changes.ts` sequences its
validated archive command. The feature-map migration archives the five completed
legacy deltas with `--skip-specs`: they were already synchronized under the old
rule, and current contracts include subsequent extensions that must be preserved.
Future batches apply specs normally. Leave the CLI upgrade to its separate change.

## OpenSpec skills

Use the repository's adapted skills:

- [world-openspec-explore](../.agents/skills/world-openspec-explore/SKILL.md) to investigate.
- [world-openspec-update-change](../.agents/skills/world-openspec-update-change/SKILL.md) to revise a plan.
- [world-openspec-apply-change](../.agents/skills/world-openspec-apply-change/SKILL.md) to implement authorized tasks.
- [world-openspec-sync-specs](../.agents/skills/world-openspec-sync-specs/SKILL.md) for the post-merge archive PR.
- [world-openspec-archive-change](../.agents/skills/world-openspec-archive-change/SKILL.md) for the post-merge archive PR.

These live in `.agents/skills/`; `.claude/skills/` links to the same files.
The `.openspec-target` marker stays `agents`, the CLI's generation target.
An `openspec update` can regenerate its own `openspec-*` skills without replacing
our `world-openspec-*` adaptations. Keep the pinned CLI until its separate upgrade.

## Capture PR evidence

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

## Keep the disk healthy

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
- Runs through `bun run test <path>` give tests and test Chrome their own
  `TMPDIR` (`/tmp/hwt-*`), and remove it with any process still using it, however
  the run ends. Direct `bun test` refuses and names the wrapper to use. Runs
  killed outright are swept by the next run once their owner process is gone. Other programs'
  scratch directories, such as a desktop Chrome's, are never touched.
- Manage disk capacity separately. Checks do not enforce a free-space
  floor; `HERDR_WORLD_MIN_FREE_GB` has no effect.

## Deliver a change

Start from the user's requested outcome and inspect existing behavior before editing.
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

Update affected contracts, navigation and current guides in the same change;
[AGENTS.md](../AGENTS.md#hard-rules) lists the documentation rules. New foundation
modules need ownership and focused evidence in the guide.

Follow the [candidate-delivery skill](../.agents/skills/candidate-delivery/SKILL.md)
for the staged formatter, hooks, PR-body check and ready-PR handoff. It owns the
delivery procedure. [CONTRIBUTING.md](../CONTRIBUTING.md#validation) describes gate
selection, CI, queue slots and retained logs; [changes/README.md](../changes/README.md)
owns the fragment format. Use the [PR template](../.github/pull_request_template.md)
to record verification and execution evidence, with `unknown` for unavailable data.

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

<a id="reach-the-owner-with-an-ask"></a>

### Reach the user with an ask

To reach the user, use `herdr-world ask` from your own Herdr TUI pane or herdr-core
terminal; no other channel.
Do not prompt the user's seat, send Herdr custom notifications, change shared
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
outbox entry. The service then alerts the user through the captured Herdr
connection (`notification.show`, sound `request`); a herdr-core terminal
alerts through the default Herdr connection. These alerts reach Herdr's toasts, every World
connected to that Herdr and Web Push. The JSON reply's `recorded` field says
whether World recorded it and `notified` what Herdr reported (`null` when a
repeated `--key` returned the recorded question without a new alert); both stay
on the final `--wait` reply. Exit 6 (`not_delivered`) means World recorded the
question but no alert was confirmed yet. `retrying: true` means the service
will retry a temporary failure with bounded backoff; an eventual alert may still
arrive. Closing the ask cancels a pending alert. A failure to record retains the
CLI's fallback through the asking pane's Herdr (the default Herdr connection
for a core terminal), names the recording failure and
exits 1. A lost service reply can therefore produce duplicate user alerts.
Report failures once; do not add a caller-side retry loop. Interrupted user
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
reopening the question. Only the user can choose **Send again…**, confirm a
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

Workers needing an answer use `--wait` in their own pane or core terminal.

## Limit merge conflict churn

Before parallel changes, identify shared implementation files and keep one writer
for overlapping edits. Recent recurring integration surfaces include the service
entry point, Town canvas, Chat and the file-size exception ledger. A source split
and a feature touching the same code should land in an agreed order; otherwise
the feature must deliberately follow the split's new module boundaries.

Use the [changelog fragment policy](../changes/README.md). Bring
an older branch forward once before final verification, inspect the conflicting
paths and preserve both behaviors. Do not repeatedly merge main solely to chase
an unrelated red CI run: first identify the failed leaf job and whether main
shares it. Branch age increases exposure, but overlapping changes cause the
conflict; a very old branch can still merge cleanly when its files are separate.

Feature PRs do not regenerate Help pictures for ordinary component changes.
Stale fingerprints are warnings; main owns the full refresh through a bot PR.
When adding or changing a help entry, use `HELP_PICTURES_IDS="<id>" bun run
help:pictures` and commit only that entry's pictures and manifest record (plus
`bun run help:docs` output when declarations change). Remove assets for deleted
entries. See [Help contribution guidance](../CONTRIBUTING.md#help-that-ships-with-a-feature).

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

Add focused regressions for behavior changes, using `bun run test <path>`.
Follow [candidate-delivery](../.agents/skills/candidate-delivery/SKILL.md) for the
complete handoff; use [contributor validation](../CONTRIBUTING.md#validation) for
check selection and diagnosis. Keep independent review separate from implementation.

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
