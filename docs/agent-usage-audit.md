# Per-PR agent usage

Account for agent usage when each PR becomes READY, then refresh the same comment
at merge. This is routine milestone accounting, not a pre-PR gate. Do not edit a
PR body solely for usage totals. Comments do not start the PR CI workflow.

```bash
bun run agent:usage pr 123
bun run agent:usage pr 123 --json
bun run agent:usage comment 123
bun run agent:usage comment 123 --post
bun run agent:usage roster-check --pr 123
```

`pr` refreshes and prints local rows by role, seat, model/effort and attribution
window, with output, cache-read, cache-write, input and response counts. JSON rows
include private local session identifiers: keep that output local. `comment`
refreshes the same accounting and prints only publishable aggregate totals;
`--post` creates one comment marked `<!-- crew-usage -->`, or edits that comment
in place. It only edits a marked comment authored by the authenticated GitHub
account, refuses duplicate marked comments and skips unchanged content.

## Sessions and assignment windows

The tool discovers named seats, harness kind and `agent_session.value` from
`herdr agent list`. It reads Codex JSONL under `$CODEX_HOME/sessions` (default
`~/.codex/sessions`) and Claude Code JSONL under `~/.claude/projects`. Use
`--sessions-dir` or `--claude-dir` to override those roots. Explicit `--session`
accepts a session ID or absolute JSONL path; an undiscovered session also needs
`--seat` and `--family codex|claude`. Discovery and prior registrations are combined,
so rotated/closed seats remain measurable while their logs remain available.
Unreadable or incomplete logs count as gaps when an assignment or established
window links their session to this PR, or a readable prompt claims the PR without
establishing a usable window. These PR mentions remain in the local ledger for
later unavailable reads. Malformed complete Claude JSONL records and invalid
consumed prompt/usage fields are quarantined individually. A gap ends a new
coordinator estimate one millisecond after the last known timestamp, retaining
the preceding valid response. Observations after damage stay ineligible for
estimates until the next valid prompt, including observations in the same
millisecond. Explicit gap evidence clips or removes affected cached estimates
even during global ingestion; unrelated windows and measured token observations
remain intact. Child damage enters the incomplete-session count without turning
child prompts into parent assignments. Codex accounting validation remains strict.
Unrelated damaged sessions do not affect the public comment. An unreadable
explicitly requested session fails the refresh. The tool never edits a harness log.

Register each builder/fixer assignment with its actual assignment timestamp. Use
separate windows for separate tasks in a shared session:

```bash
bun run agent:usage assign 123 --seat builder --role builder \
  --from 2026-10-25T10:00:00Z --until 2026-10-25T11:00:00Z
```

`--until` is required and records the actual last-push timestamp, exclusive. Refresh
it by rerunning the same assignment (same PR, session, role and start) after another
push. Use a recorded push completion time, such as the local remote-tracking
reflog after a successful push. GitHub's deprecated `pushedDate` is not a usable
source. Commit authored/committed times and PR update times are not push times.
Choose one exact session with `--session` when a seat has rotated. Roles are
`builder`, `fixer`, `reviewer:<seat>` and `coordinator`; explicit windows can also
supply missing reviewer/coordinator evidence.

Review windows start at a local prompt requesting review/confirmation of exactly
one `#N` and
end at that seat's canonical GitHub review `RESULT #N` submission timestamp.
Missing or conflicting sender/PR claims cannot establish a window; quoted or
fenced claims do not override the canonical header. FirstMate/clerk
prompts mentioning exactly one `#N` produce coordinator estimates, ending at the
next user prompt or 30 minutes, whichever is earlier. Multi-PR prompts remain
unattributed. Only user prompt text is inspected for these heuristics; assistant
prose is not evidence of an assignment.

Each response belongs to at most one PR/role. Windows use `[from, until)`;
conflicting claims remain `unattributed`. Explicit assignments and completed
reviews take precedence over coordinator estimates. The local report includes the
shared unattributed pool, excluded from PR totals. Public comments omit that
pool's counts so unrelated local work cannot affect published totals. That pool covers loaded
sessions, including other work, and is not an estimate of missing PR usage.

## Local ledger and measurement limits

Full session/model/effort/window/token rows persist in the primary checkout's
ignored `.agents/crew-gate/usage.sqlite`, shared across its worktrees. `--store`
selects another local database. SQLite serializes writes; only usage-owned tables
are touched. Coordlab's separate `gate.sqlite` is not modified. Keep the ledger
private and retain it before pruning worktrees or deleting harness logs.

Codex uses per-response `token_usage_record` entries, including recorded compaction
calls, with model/effort from rollout context. `token_count.info.last_token_usage`
snapshots are deduplicated by cumulative usage. The first dedicated record in a
log establishes precedence for its remaining suffix: later snapshots are mirrors,
even when their cumulative counters drift. Earlier snapshot-only history remains
measured. The same boundary retires covered fallback entries in an existing ledger,
so cold and incremental imports agree. Prefix snapshots that identify a later
response by counter or a unique exact timestamp/usage match are replaced while
preserving their earliest usage timestamp. A response-only refresh retains that
timestamp, so changing representation cannot move usage to another PR window.
Incomplete Codex accounting is a measurement gap, never a recorded zero.
Claude assistant chunks are deduplicated by `message.id`, taking the maximum of
each usage field and retaining `message.model`. Companion transcripts under
`<session>/subagents/` are included under the parent seat/session and attributed
by their response timestamps; child prompts do not establish parent assignments. Each streamed response is attributed at its first
usage timestamp. A partial final JSONL line is deferred until the next refresh.

Input in PR reports excludes cache reads/writes for both harnesses; output includes
reasoning. Total is input + cache read + cache write + output. These are recorded
tokens, not billed cost. Unknown models remain unknown in public comments; arbitrary
local strings, session IDs/paths/URLs, hostnames, usernames and emails are omitted.
Undiscovered sessions, unavailable logs, unrecorded compactions and responses after
the last refresh are outside the measured boundary. Previously recorded responses and established windows
are retained if a log becomes unavailable or readable history is shortened.
Current GitHub evidence can invalidate a previously inferred review claim. Updating at merge requires running the
command again; there is no background scheduler.

## Expected models and recorded drift

The shared ignored `.agents/crew-gate/config.json` accepts a top-level `roster`
map. Preserve its other keys, including `reviewers` and `aggregateChecks`, when
adding or updating expectations. Seat names are exact lowercase names from
Herdr; `model` is required and `effort` is optional:

```json
{
  "roster": {
    "builder": { "model": "gpt-6.1-sol", "effort": "xhigh" },
    "reviewer": { "model": "gpt-6-astra", "effort": "high" }
  }
}
```

[The example fragment](../scripts/agent/usage-config.example.json) contains
synthetic seats. Expectations come from the operator's assigned roster, rather
than the model currently observed in a response. Gate tooling can read the same
field when its consumer is added; usage tooling owns no gate tables or decisions.

```bash
bun run agent:usage roster-check
bun run agent:usage roster-check --pr 123
bun run agent:usage roster-check --pr 123 --json
```

The default check refreshes discovered/registered logs and examines all retained
session history, including locally unattributed usage. Its per-model windows can
include historical differences; it does not claim to read live harness settings.
`--pr` refreshes that PR's attribution and checks only its attributed windows.
The local report includes seat, expected and recorded model/effort, response count
and window. Use `--config` to select another local shared-config file; `--store`
continues to select a local ledger. The command preserves unrelated PR windows; newly observed gaps invalidate
affected estimates across the shared ledger.

Comparison is exact. Missing recorded effort is `unknown` when an effort was
expected, while an omitted expected effort compares the model alone. Missing
roster entries are `unconfigured`. Exit 0 means measured responses match; exit 2
flags drift, unknown/unconfigured observations, no measured responses, or an
incomplete applicable session. Invalid configuration or explicitly requested unreadable input uses exit 1. The command
reports evidence and leaves model selection or restarting seats to the operator.
Human and JSON reports both show the applicable incomplete-session count; a
partial measurement cannot report a clean result merely because measured models
match. Empty scopes explicitly report that no responses were measured.

PR comments include a drift note when attributed responses differ from their
roster. Notes publish model names only, including effort-only drift under that
model's name. Unknown observations and absent expectations get separate notes.
Effort values, seats, session identifiers/paths and unrelated model history stay
local. Existing marked comments still update only through an explicit `--post`.

## Optional bounded Codex audit

The original ad hoc audit remains available:

```bash
bun run agent:usage --session <session-id> --from <ISO-UTC> --until <ISO-UTC>
```

Repeat `--session` for contributors, or omit it to use `CODEX_SESSION_ID`. Pass
subagent rollout IDs explicitly; inherited environment IDs can identify the
parent instead. Legacy `--pr` only labels this bounded report and does not register
attribution. This older report includes cached input in input and reasoning in
output. Add `--tooling` for aggregate tool calls, recognized literal check commands
and output size, without publishing commands or output. Dynamic shell scripts and
checks inside pre-push hooks may be missed. Local Prometheus totals without session
labels cannot substitute for PR attribution.
