# Harness usage data

World collects token usage on demand from supported harness session files by
default. The service owns the numeric records; Town and Board can both read
`world.usage.get`. Town's expenses boards read it: the city billboard (today
or 7 days), a board beside each reception and the Economy line on room and
table cards; see [Town expenses boards](#town-expenses-boards). Existing Town
Summary spend controls still use their configured metrics provider.

## Sources and inventory

| Harness | Host-local source | Accounting and evidence |
| --- | --- | --- |
| Claude Code | Projects under the Claude configuration directory | Assistant `message.id`, `message.model`, `message.usage` and timestamp; repeated response blocks preserve the highest observed counters once per ID. Existing crew usage tooling provides repository prior art. |
| Codex | `sessions` and `archived_sessions` below the Codex home | `session_meta`, `turn_context.model`, and `event_msg` token counts. Cumulative differences count once; an unknown starting baseline or decrease makes coverage partial. Plain and zstd rollouts are supported. |
| Pi | `sessions` below the Pi agent directory | Session header ID and assistant message entries: `usage.input`, `output`, `cacheRead`, `cacheWrite`. Entry IDs deduplicate responses; all logged branches represent incurred usage. |
| Gemini CLI | Session files under the Gemini temporary project directories | JSON conversations and JSONL records with session metadata and Gemini message `tokens`; message IDs deduplicate updates. Input cache is a subset; output includes thought tokens, while thought totals remain available as a subset. |

Source format references: [Claude hook transcript ownership](https://code.claude.com/docs/en/hooks),
[Codex accounting semantics](https://github.com/openai/symphony/blob/main/elixir/docs/token_accounting.md),
[Pi message types](https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/types.ts),
and [Gemini recording types](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/chatRecordingTypes.ts).
These are format references rather than a promise that arbitrary future versions
will retain the same schema. Unsupported or invalid records disclose partial
coverage. Other detected harnesses report `unsupported`.

Local collection runs in a runtime-owned worker. SSH runs the same collector
through the owning OpenSSH destination, using Bun or Node with a plain `sh -c`
command. Request paths/options travel over stdin; only numeric projections return.
Node zstd support is optional; without a decoder compressed sources report partial
coverage. Remote failures never select local files. Harness roots honor
`CLAUDE_CONFIG_DIR`, `CODEX_HOME` and `PI_CODING_AGENT_DIR` on the transcript host.
Exact runtime-reported files must be inside those roots with a supported extension.
Reads share one descriptor for identity and numeric parsing, checked against
admitted file identity and containment before reading. Opening refuses symlinks
where supported; the descriptor identity check is required on every platform. JSON/compressed input limits
apply while reading that descriptor, including concurrent pathname replacement.

Each reader keeps a private per-file stat/offset and numeric parser cache on its
own host. Unchanged files need no transcript read; append-only JSONL reads resume
at the last complete line. Changed JSONL files check 4 KiB digest samples at the
head and just before the saved offset. A changed sample, shrink, inode change or
backward mtime rebuilds the affected session. Each UTC day also forces a full
rebuild. These bounded checks can miss a pathological same-inode growing rewrite
that preserves both samples until the daily rebuild; token observations and
prices remain estimates. Unchanged files require no transcript reads within that
day. JSON and compressed files are reloaded only when changed or rebuilt.
Canonical identity precedes projection, so preambles and copies share one reader.
Inventory favors bound files, then newest files. Older Codex dated directories
receive a bounded metadata scan: recent file activity is collected even after a
cold restart, while expired bodies stay out of numeric reads. Hitting discovery
capacity reports partial/truncated coverage. A directory date never proves source
absence or a title prefix unique; incomplete identity evidence stays unresolved.
Older metadata outside those trees may disprove uniqueness without adding expired
tokens.

## Read contract

Authenticated browser RPC:

```json
{"id":"usage-example","method":"world.usage.get","params":{"window":"today"}}
```

`window` is `today` (default) or `7d`. Both start at UTC midnight; `7d` includes
today and the preceding six UTC dates. The upper boundary is the observation
time and is exclusive. Midnight changes the query window without modifying
harness logs. A service restart rebuilds observations from available logs.

The response is typed by `shared/usage.ts`:

- `entities`: digest-derived `usage` IDs, connector, harness, exact model, UTC day,
  numeric counters, response count, first/last observation, estimate and source
  health. IDs derive from the qualified connection/generation and session/day/model;
  reads do not allocate durable ID records.
- Qualified host ownership (`connection_id`, `connection_generation`), plus
  `workspace_id`, `tab_id` and `pane_id` only for a unique current session/file
  match. A title prefix must resolve uniquely in a complete source inventory;
  cwd alone is insufficient. Unknown sessions and duplicate
  claims remain host-level `unattributed` usage. Topology changes invalidate
  cached pane attribution until the connector refreshes. More than 128 supplied
  agents disclose truncation and keep all usage host-level. A complete
  post-collection agent listing must preserve the initial claim set; changed,
  newly added or conflicting claims invalidate pane attribution for that read.
- `total`, `unattributed` and `rollups` for host, workspace, tab and pane. Each
  level is a projection of the same entities; do not add levels together.
  Stale entities remain visible but are excluded from current totals.
- `sources`: `available`, `partial`, `missing`, `stale`, `unavailable` or
  `unsupported`, with check/success times and `refreshing`. Missing records
  (`records: 0`, null cost) do not establish measured zero usage. Partial and
  truncated responses are lower-coverage observations, not complete expenses.
- `limits`: subscription limits per host and harness, independent of `window`;
  see [Subscription limits](#subscription-limits).
- `telemetry`: optional configured Prometheus/OTel rolling-24-hour comparison,
  explicitly excluded from the log totals. Its window differs from the UTC
  windows above. No OTel configuration is needed for harness-log collection.

Tokens have disjoint `input` (uncached), `cache_read`, `cache_write` and `output`
categories. `reasoning` is a subset of output and must not be added again.
`total_tokens` sums the four disjoint categories. Gemini tool-prompt tokens
contribute to input. `observation_span_ms` is the span between usage observations,
not CPU time, active working time or a billable duration. Timestamps come from
the source host; no external clock synchronization is claimed.

OTel with a matching harness message/turn identity can replace a missing log
observation, with logs winning on overlap. Scoped OTel totals may count only
where no log connector covers that scope at all. The current configured
Prometheus provider has neither qualified session/event identity nor UTC-window
evidence, so its totals remain comparison data. They cannot safely fill a pane
or host balance. No reported monetary metric is used as the token estimate.

## Subscription limits

Each `limits` entry names a host (`connection_id`, `connection_generation`), a
harness and a `state`, with `windows` of `window_minutes`, `used_percent` (0–100)
and `resets_at` (milliseconds, or null), plus `observed_at` and `source`. When
the newest observation is a refusal, `windows` is empty and `reached` holds the
refused window's `window_minutes` (or null when unnamed) and its `resets_at`;
otherwise `reached` is null.

| Harness | Source | What World reads |
| --- | --- | --- |
| Codex | Codex session log (`codex-session-log`) | The `rate_limits` object on rollout `token_count` events: the `primary` and `secondary` windows (`secondary` may be null). Only the account-wide limit (`limit_id` absent or `codex`) counts. The newest observation across that host's admitted rollouts wins. |
| Claude Code | World status line tap (`claude-status-line`) | Claude Code passes `rate_limits` (`five_hour` and `seven_day`, each `used_percentage` and `resets_at`) only to its status line, and saves no limit levels to disk. When World starts a Claude agent from its launcher, it adds `--settings` with a status line command for that launch only: the tap. The tap writes the two windows' numbers and the time to `~/.cache/herdr-world/claude-status-line.json` on that host, then runs your own status line command, if any, with the same input and prints its output unchanged. It finds yours by Claude Code's precedence below the flag: `.claude/settings.local.json`, then the launch directory's `.claude/settings.json`, then `settings.json` in `CLAUDE_CONFIG_DIR` (default `~/.claude`). Like Claude Code, it reads the local file at the canonical Git root (a linked worktree's main checkout) when you own that root, its `.git` and `.claude` on a host with user IDs, and otherwise in the launch directory. It never writes those files. On World's own host the tap runs on World's executable (as Bun), so neither Bun nor Node is needed. On an SSH host World first asks for Bun, then Node; with neither, that launch gets no tap and your status line stays exactly as configured. The runtime starts from the root directory, so a project's `.env` or `bunfig.toml` never loads, and your command runs in the session's directory without the tap's own variables. Claude Code runs status lines with `sh`, or Git Bash on Windows; on Windows the tap runs yours with `bash` too. Agents started outside World's launcher (or by Ranger) have no tap. |
| Claude Code | Claude transcript (`claude-transcript`) | A refusal: an assistant record with `apiError: "usage_limit_reached"`, read from `apiErrorParams.rate_limit_info` (`resetsAt`, and `rateLimitType` as the window). A later answer in the same session cancels it. It reads "limit reached, resets …", never a percent. |

States: `available` is current. `stale` means the observation is more than three
hours old, a window's reset time has passed, or the latest read failed and the
last numbers were kept. `missing` means a successful read found no observation
on that host. No state is a measured zero or a full tank. For Claude, the newer of the
latest tap reading and the latest refusal wins; a refusal is stale once its
reset passes. Pi and Gemini do not appear.

Limits come from the same collector, cache and SSH program as token usage and
share their bounds. The collector reads the tap's file only if it is a small
regular file (never a symlink) and validates every number again. Any other file, or
a failed read, marks Claude's source partial, so the last numbers stay as stale. Plan names, credit balances, limit names, account IDs and
other `rate_limits` fields are dropped on the transcript host; malformed or
future-dated windows are ignored. World never calls a provider API, reads
credentials or types `/usage` into a pane.

Town shows these as fuel gauges on the board sign and per host in the Summary;
see FEATURES.md. The board re-reads them every 30 seconds while it is shown,
so a new reading reaches the sign within about a minute. A harness reported as `unsupported` appears on the sign as
**not available** with its reason, never as an empty or full gauge.

## Town expenses boards

Town reads `world.usage.get` for its boards (`web/src/world/town/townExpenses.ts`):

- The city billboard shows `total` for the chosen window, plus `unattributed`
  (usage tied to no pane). A building's board shows that host's `host` rollup
  and its three costliest `workspace` rollups (by cost when all are priced,
  otherwise by tokens), plus the host's entities with no workspace as
  unattributed. Each figure is one rollup level; levels are never added.
- A host's board uses the connection's newest runtime generation in the read
  and never another connection's numbers.
- Stale entities stay out of the figures; the board says "stale data left
  out". A partial source or a truncated read says "partial".
- A null cost stays null: "no price table" when no counted row has a table
  version, otherwise "some models unpriced".
- A host with no available or partial source reads "no data", and the city
  board counts such hosts. A readable host with no records reads "none
  recorded". Neither is shown as zero.
- Boards re-read about once a minute while Town shows them and when the page
  regains focus or becomes visible; the shared store sends at most one read
  per window every 30 seconds.

Tests use the synthetic fixture in `web/src/world/testing/usageFixture.ts`,
which shapes reads like the service with example hosts, models and rates.

## Optional local price table

In the instance's settings `custom` object, `world_usage_prices_v1` may contain
an operator-maintained exact-model price table. Rates are USD per million tokens
for the four disjoint categories; this example uses synthetic models and rates:

```json
{
  "world_usage_prices_v1": {
    "version": "example-2026-11",
    "models": {
      "example-model": {"input": 2, "cache_read": 0.2, "cache_write": 2.5, "output": 10}
    }
  }
}
```

World estimates each row with that version of the table. There is no implicit
model alias or current-price lookup. Missing/invalid tables and unknown models
leave estimated cost null while retaining tokens. Aggregate estimated cost is
null if any included row is unpriced; `unpriced_records` explains the gap.
This estimates token consumption at supplied rates, not subscription charges,
discounts, taxes, invoices or the amount a provider will bill. Updating a table
reprices the retained observations and reports the new version.

## Privacy, limits and lifetime

JSON is decoded transiently on the transcript host. The private cache keeps
file paths/stats/offsets and numeric parser context, with hashed session/response
evidence. No content or unfinished-line text is cached. SSH transfers that projection, never transcript contents. The API
returns no paths, native session IDs, prompts, replies, reasoning, tool content
or raw filesystem/SSH errors. The service keeps no usage transcript archive.

Collection admits at most 128 exact bound files plus ordinary inventory within
a 384-file cap, with 64 ordinary files and 2,048 directory entries per harness.
When resolving Codex title prefixes, a separate cap of 64 older identity-only
files keeps metadata discovery from crowding out current numeric observations.
That cap shares the existing read/deadline budgets; exhaustion discloses
truncation and refuses prefix attribution.
Depth is at most eight. Reads have a 10-second work budget, 64 MiB per plain or
decoded file, 16 MiB per compressed/JSON input, 256 MiB plain/input host budget,
500,000 lines and 32,768 response identities per session. Oversized/incomplete
lines, unreadable files and exhausted capacity are disclosed. A line-budget stop
leaves unparsed bytes retryable; retiring parser state also retires its cursors.
Daily rollups retain at most seven UTC dates, 1,024 rows and a 512 KiB numeric host response.

The service refreshes on reads, at most once per 30 seconds per runtime, with
up to four collectors concurrently and a two-second wait before returning the
current observation plus `refreshing`. It admits 16 connections and returns at
most 128 entities plus their rollups, with a 768 KiB response budget below the
1 MiB frame. Bounds set `truncated`; totals describe the returned entities.
Fixed counts and deadlines bound work and do not promise full host history.
The private cache admits at most 448 files and 32 MiB of encoded state, evicting
oldest session groups when either bound is reached. Runtime replacement, close
or service restart drops it; bindings and observations are rebuilt.

One owned 20-second operation deadline covers identity discovery, collection,
decompression and claim revalidation. Runtime retirement, replacement and
service shutdown abort that work. Local workers terminate and report exit even
when a filesystem promise is blocked. SSH keeps an input lifetime channel open;
closing it ends the remote program. The service bounds each stdout response frame at 768 KiB and
lifetime stderr at 16 KiB while reading, and kills and reaps the owned SSH process on
overflow, cancellation or failure. Numeric replies are validated inside that
ownership boundary; malformed or unsolicited idle replies stop and reap the
reader without waiting for another request. A replacement generation starts
independently of its cancelled predecessor; shutdown drains the owned resources before
finishing. A still-current source that times out reports unavailable and retains
its last bounded numbers as stale, outside current totals.
