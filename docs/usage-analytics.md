# Usage analytics data and API

World exposes one local data service for the Usage surface and agent cards.
There are no new screens in this delivery. Types live in
[`shared/usageAnalytics.ts`](../shared/usageAnalytics.ts); numeric harness records,
subscription limits and context sizes retain their existing
[`world.usage.get` contract](usage.md#read-contract).

## Try with the CLI

From this checkout, run these commands without starting a server:

```sh
bun server/src/index.ts usage --fixture --window 7d --group-by day --json
bun server/src/index.ts usage --fixture --group-by agent
```

The fixture uses the real aggregator with synthetic inputs: 1,700 tokens,
10,000 active milliseconds, 10,000 waiting milliseconds, one known PR opened
and merged, a 100% used Codex limit and unknown dollar cost. Seven-day output
also includes six unknown daily buckets. It reads no files or provider account
and never sends a request to World. `--fixture` is CLI-only, not an API option.

For live data, use `herdr-world usage --window 7d --group-by project --json`.
When running the checkout's CLI against a dispatcher-owned preview, set
`HERDR_WORLD_URL` to its loopback URL and use that instance's normal CLI token
discovery (or `HERDR_WORLD_DATA_DIR`). The token must belong to the same instance.
No special agent pane is needed for this read. Non-JSON terminal output prints
`unknown` for missing numbers; piped output defaults to JSON.

## Calls for consumers

| Call | Input | Data |
| --- | --- | --- |
| WebSocket `world.usage.analytics` | Query below | Grouped effort, tokens, costs and PR events; source health and limits |
| WebSocket `world.usage.get` | `{"window":"today"}` or `{"window":"7d"}` | Existing bounded harness/model/day entities, host/room/desk/pane rollups, limits and context; unchanged window/default |
| `POST /api/world/cli` command `usage` | `{"command":"usage","params":QUERY}` | Same analytics response under `result`, plus normal CLI actor and command evidence |

WebSocket calls use the existing authenticated same-origin World connection.
The HTTP CLI endpoint requires its existing derived CLI bearer token, a loopback
peer and no Origin header. It returns `{ "ok":true, "actor":..., "result":... }`;
invalid queries return HTTP 400 / `code:"usage"`, unavailable service reads 503.
Browser admission refuses revoked clients. Neither path chooses a default runtime.

Example analytics call:

```json
{"id":"usage-chart","method":"world.usage.analytics","params":{"window":"today","group_by":"day"}}
```

Example response (synthetic, selected fields; all metric keys are shown):

```json
{
  "id": "usage-chart",
  "result": {
    "version": 1,
    "incarnation": "usage-fixture",
    "observed_at": 1795089600000,
    "window": {"kind":"today","from":1795046400000,"until":1795089600000},
    "retention_days": 7,
    "group_by": "day",
    "total": {
      "active_ms": {"value":10000,"coverage":"partial"},
      "waiting_on_you_ms": {"value":10000,"coverage":"partial"},
      "observed_ms": 20000,
      "tokens": {"input":1200,"cache_read":400,"cache_write":0,"output":100,"reasoning":0},
      "total_tokens": {"value":1700,"coverage":"partial"},
      "reported_cost_usd": {"value":null,"coverage":"unknown"},
      "estimated_cost_usd": {"value":null,"coverage":"unknown"},
      "prs_opened": {"value":1,"coverage":"partial"},
      "prs_merged": {"value":1,"coverage":"partial"}
    },
    "rows": [{"key":"2026-11-19","dimension":"2026-11-19","identity":null}],
    "coverage": {
      "truncated": false,
      "activity": "partial",
      "pull_requests": "unknown",
      "pull_request_source": {"state":"unavailable","checked_at":null,"last_success_at":null,"refreshing":false},
      "project_lookups_truncated": false,
      "history": "available",
      "time_basis": "observed-runtime-status"
    }
  }
}
```

Each actual `rows` entry includes the same metric keys as `total`. The response
also contains `projects` (`id`, connection ID/generation, checkout-name `label`),
`sources` (existing numeric source health) and `limits` (existing numeric
subscription windows, refusal/reset and freshness). These arrays use the exact
types in the shared contract; native session IDs, filesystem paths, transcript
content, account identifiers, credentials and raw source errors are absent.

Example existing numeric call and response excerpt:

```json
{"id":"usage-logs","method":"world.usage.get","params":{"window":"today"}}
{"id":"usage-logs","result":{"version":1,"entities":[],"total":{"tokens":{"input":0,"cache_read":0,"cache_write":0,"output":0,"reasoning":0},"total_tokens":0,"estimated_cost_usd":null,"unpriced_records":0,"records":0},"limits":[],"contexts":[]}}
```

That legacy empty numeric summary does not establish zero usage. The new
analytics metrics instead return `value:null, coverage:"unknown"` when there
are no measurements. For the HTTP call, the analytics result above is wrapped
by the usual CLI envelope, for example
`{"ok":true,"actor":{"label":"unverified","verified":false},"result":{"version":1,...}}`.

## Query and grouping

`window` defaults to `today`; `7d` starts six UTC midnights earlier. `group_by`
defaults to `day` and accepts `agent`, `project`, `room`, `day`, `run`. All windows are
half-open, ending at the response observation time. Empty days are explicit
unknown buckets. `total` includes admitted facts before row clipping.

Filters are `connection_id` plus `connection_generation` together, optional
`pane_id`, `workspace_id` and `project_id`. Pane/room filters require the
connection pair. CLI equivalents are `--connection ID --generation N`,
`--pane ID`, `--room ID`, `--project ID`. Copy opaque project IDs from `projects`.
Unknown keys, empty/oversize selectors, negative/noninteger generations,
unqualified pane/room filters and unsupported windows/grouping refuse. Paths,
custom retention, providers and arbitrary SQL are not query inputs. A valid
selector with no evidence returns unknown metrics, never another connection.

`dimension:null` is an explicit unattributed bucket. Agent dimensions are opaque
session/program-qualified IDs, not harness names. Room dimensions encode
`[connection ID,generation,workspace ID]`, with that structured identity also on
the row. Project dimensions reference `projects.id`; linked Git worktrees on one
connection share a common-directory-derived ID. Different connections remain
distinct projects. Unresolved/non-Git checkouts remain unattributed. A historical
project ID can outlive the currently observed project labels.

A run is one harness session on one transcript host, across its days and
models. `group_by:"run"` rows are heaviest first and carry `run`: `source`,
harness, models (most tokens first), `role`, `branch`, `pull_request`,
`attribution`, `calls` (API responses, each counted once), `first_at`/`last_at`,
`max_prompt_tokens` (largest single prompt, input plus cache), `spans` and
`context` (its pane's current context fill, only while it runs in a pane).
`role` is one of `worker`, `fixer`, `reviewer`, `checker` or `scout`, read from
the run's first prompt (`builder` reads as worker; a `/review` command as
reviewer) and null when that prompt names none. The prompt text is matched and
dropped; it is never stored or published. `branch` is the checkout branch the
harness log records, never `HEAD`. Older services omit the run detail;
consumers show it as unknown.

`spans` are sorted, bounded `[from, to]` millisecond pairs: when the run was
going. Responses at most ten minutes apart join into one span (the host reader
keeps at most 48 per run and day), and the spans World saw the run's agent
`working` join in, so a long call between two responses still counts. World's
own working spans join only where they touch: an observed idle or blocked gap,
however short, stays a gap, so it never becomes overlap with another agent.
Past 48 spans in a day, an agent's two closest spans join (the bound). Runs at
once is the overlap of these spans, never a count of runs that answered
somewhere in an hour.

Every harness World supports gets World's own measurement: time `working` and
`blocked` (waiting on you) per agent, and runs. The reader seam
([`shared/usageHarnesses.ts`](../shared/usageHarnesses.ts)) names the
harnesses whose session logs World also reads tokens from: today Claude,
Codex, Pi and Gemini. An agent World saw while its pane held a transcript run
is joined to that run (the newest run in its pane), and the link is kept with
the activity history. An agent of any other harness, or of a harness World
reads whose log has no run yet (before its first response, or while the log is
unreadable), is a run of its own, keyed `world:<agent ID>`, with
`source:"world"`: `calls`, `max_prompt_tokens` and
token and cost metrics are `null` (not available), never zero, while
`active_ms`, `waiting_on_you_ms` and `spans` come from World's measurement.

`pull_request` comes from a work link the agent's own session validated (the
link's session fingerprint matches the pane's current agent session) naming
exactly one GitHub pull request; that link is kept with the run
(`attribution:"link"`). A branch alone never names a pull request: it
carries no repository, and the same branch name in another repository is not
this run's work. When a catalogue pull request has the run's branch but no
validated link proves it, `pull_request` is null and `attribution` is
`ambiguous`: World never picks the only match or the most recently updated.
`none` means no evidence.

For a character card, query `group_by:"agent"` with its qualified pane filter,
or `group_by:"run"` and match the row's qualified pane identity.
For a chart, query `group_by:"day"` and optionally filter that pane, room or
project. Resolve presentation names through the existing World snapshot and
project catalogue. Session, room and checkout evidence is rechecked after Git
reads; changed or retired evidence cannot attach numbers to a replacement.

## Meaning, gaps and limits

- Every non-null metric is a known subtotal with partial coverage. Unknown
  (`null`) is different from an observed zero. Do not turn null into a zero bar
  or silently treat partial coverage as complete lifetime effort.
- Active time means observed `working`; waiting-on-you means observed `blocked`,
  excluding an explicitly reported usage-limit block. Idle and done contribute
  observed coverage, not wait. Source silence is unknown. Each fresh snapshot
  leases status for at most 15 seconds; invalidation/disconnection ends it sooner.
  There is no background activity polling, CPU measurement or billing-time claim.
- Daily numeric time history is saved on analytics reads and clean stop in
  private `usage-activity.json`, capped at 8,192 rows and seven UTC dates. Open
  intervals never resume after restart. A crash can lose unsaved time; corrupt
  history reports `history:"unavailable"`. Capacity loss is explicit. Project
  time starts only when project evidence is known; earlier time stays unattributed.
- Tokens use the existing bounded host log readers, deduplication and exact
  session binding. Analytics aggregates all admitted rows before the legacy
  128-detail cap. Stale token rows are excluded. Log locations use current
  session/room/checkout evidence, not a historical movement audit.
- Connections known to share a transcript host count numeric rows once. Conflicting
  current claims stay unattributed. Physical equality of different SSH aliases
  cannot be proven; avoid configuring duplicate aliases for usage totals.
- Only Pi's persisted numeric cost is currently reported as dollars. Claude/Codex
  logs here expose tokens and limits, not a dollar charge. Optional configured
  exact-model prices remain separately named estimates; estimates never populate
  reported cost. Neither field describes subscription spending or an invoice.
- PR events count distinct authored PRs in World's existing configured GitHub
  catalogue, by source `createdAt`/merge timestamps. Closed-unmerged PRs, older
  PRs and records outside bounded source searches may be absent. Agent/project/
  room attribution requires one matching current session link; it describes
  association, not proof that an agent performed the forge action. Shared or
  stale session links remain unattributed. Source health/check times and
  refreshing state accompany the subtotals; absent timestamps are unknown.
- Existing collection limits remain: 16 connections, four concurrent collectors,
  1,024 numeric rows per host, 128 attribution candidates and seven UTC dates.
  Analytics resolves at most 32 distinct checkouts, four at a time, with the
  existing eight-second Git deadline and a 128-entry/two-minute cache. It returns
  at most 512 groups and stays below 768 KiB by clipping rows, keeping totals.
- Unix local/SSH TUI and core share the service. Core uses explicit session/resume
  arguments or Codex title evidence; no cwd-based transcript guessing. Unsupported
  Windows host tools and unsupported harness formats stay unavailable/unknown.
  No provider request, credential read, terminal input or UI action is added.

## Usage screens

Town's observatory and the Usage screens read `group_by:"run"` and
`group_by:"project"` for `7d` through one shared browser read per grouping,
refreshed at most every 30 seconds; agent cards share the same read (see
[FEATURES.md](../openspec/specs/world-surfaces/notes.md#visual-control-plane)). For testing rare states without real
logs, open World with `?usageFixture` (busy), `?usageFixture=reached` (Claude's
5-hour limit reached) or `?usageFixture=empty` (nothing observed). The page
removes the parameter at once and the switch lasts until the next page load.
Only `world.usage.analytics` answers change, with synthetic runs on
`example-org/web-app`; every other read is real.

Focused evidence lives beside the implementation: activity, analytics, projects,
core, projection and service tests, plus CLI and admitted RPC tests. These prove
numeric behavior and refusal boundaries; visual delivery belongs to the consumer.
