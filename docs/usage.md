# Harness usage data

The [World harness skill](harness-integrations.md) teaches agents to ask questions
and report work. Installing the Claude integration also registers a chained
subscription-limits tap for sessions started outside World. It preserves your
existing status line; uninstall restores it. Other integrations install only the skill.

World collects token usage on demand from supported harness session files by
default. The service owns the numeric records; Town and Board can both read
`world.usage.get`. Town's expenses boards read it: the city billboard (today
or 7 days), the expenses on each reception board and the Economy line on room and
table cards and the Town board's **Economy today** line; see [Town expenses boards](#town-expenses-boards). Existing Town
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
  post-collection agent listing must preserve the initial claim set; unrelated
  activity-title changes and partial log coverage do not erase a valid binding. Changed,
  newly added or conflicting claims invalidate pane attribution for that read.
- `total`, `unattributed` and `rollups` for host, workspace, tab and pane. Each
  level projects all collected records before transport detail limits; do not add
  levels together. Host rollups include an `unattributed` subtotal for usage
  without a current room. This subtotal is already included in the host total.
  A seven-day read also supplies `today` (total, unattributed and rollups) from
  the same observation, and `price_table_version` names its table or is null.
  `details_truncated` means detail rows or non-host rollups were omitted to fit
  the frame; city and host totals remain intact.
  Stale entities remain visible but are excluded from current totals.
- `sources`: `available`, `partial`, `missing`, `stale`, `unavailable` or
  `unsupported`, with check/success times and `refreshing`. Missing records
  (`records: 0`, null cost) do not establish measured zero usage. Partial and
  truncated responses are lower-coverage observations, not complete expenses.
- `limits`: subscription limits per host and harness, independent of `window`;
  see [Subscription limits](#subscription-limits).
- `contexts`: how full each attributed agent pane's context is, independent of
  `window`; see [Context fill](#context-fill).
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
| Claude Code | World status line tap (`claude-status-line`) | Claude Code passes `rate_limits` (`five_hour` and `seven_day`, each `used_percentage` and `resets_at`) only to its status line, and saves no limit levels to disk. When World starts a Claude agent from its launcher, it adds `--settings` with a status line command for that launch only: the tap. The tap writes the two windows' numbers and the time to `~/.cache/herdr-world/claude-status-line.json` on that host (every Claude session writes the same file with its own last snapshot, so within one window, the same `resets_at`, it keeps the highest reading; a later `resets_at` starts fresh and an earlier one never replaces it), then runs your own status line command, if any, with the same input and prints its output unchanged. It finds yours by Claude Code's precedence below the flag: `.claude/settings.local.json`, then the launch directory's `.claude/settings.json`, then `settings.json` in `CLAUDE_CONFIG_DIR` (default `~/.claude`). Like Claude Code, it reads the local file at the canonical Git root (a linked worktree's main checkout) when you own that root, its `.git` and `.claude` on a host with user IDs, and otherwise in the launch directory. The per-launch tap only reads those files; explicit integration installation changes the user setting as described in the [integration guide](harness-integrations.md#claude-limits-tap). On World's own host the tap runs on World's executable (as Bun), so neither Bun nor Node is needed. On an SSH host World first asks for Bun, then Node; with neither, that launch gets no tap and your status line stays exactly as configured. The runtime starts from the root directory, so a project's `.env` or `bunfig.toml` never loads, and your command runs in the session's directory without the tap's own variables. Claude Code runs status lines with `sh`, or Git Bash on Windows; on Windows the tap runs yours with `bash` too. After `herdr-world integration install claude`, sessions started outside World (including Ranger) also use the tap unless a project or explicit setting overrides it. Without installation, only World-launched sessions have the tap. |
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

Separately from these host-level limits, each agent's own session can end
with a usage-limit stop: Codex's `rate_limit_reached_type` or usage-limit
error in its rollout, or Claude Code's limit refusal in its transcript (the
older `Claude AI usage limit reached|<time>` text counts too). The agent read
model (`agent_quest.list` and Chat's conversation) returns it as `usage_stop`
(`harness`, `at`, `resets_at` or null) while its reset is ahead and nothing
newer from the agent follows; Town shows that agent out of fuel (see
FEATURES.md).

Town shows these as fuel gauges on the board sign and per host in the Summary;
see FEATURES.md. The board re-reads them every 30 seconds while it is shown,
so a new reading reaches the sign within about a minute. A harness reported as `unsupported` appears on the sign as
**not available** with its reason, never as an empty or full gauge.

## Context fill

Each `contexts` entry names one agent pane (`connection_id`,
`connection_generation`, `workspace_id`, `tab_id`, `pane_id`), its `harness` and
exact `model`, `used_tokens`, `window_tokens` and `observed_at`. Only a fresh
read with a unique current-session match produces an entry, under the same
attribution rules as pane usage; when a session has several files, the newest
observation wins. A failed or stale host has none.

`used_tokens` is the prompt of the session's newest response, what it carries
into its next turn:

| Harness | Prompt size |
| --- | --- |
| Claude Code | The newest main-thread assistant record's `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. Subagent (sidechain), API-error and synthetic records are skipped. |
| Codex | `last_token_usage.input_tokens` of the newest `token_count` event (cached input is part of it), with Codex's own `model_context_window`. |
| Pi | The newest assistant message's `input + cacheRead + cacheWrite`. |
| Gemini CLI | The newest Gemini message's `input + tool` tokens (cached input is part of `input`). |

`window_tokens` is the window the harness reported (Codex), else a small table
by model name: Opus 4 to 4.5, Haiku 4.5 and Claude 3 have 200,000; Opus 4.7
and later, Sonnet 5 and later, Haiku 5.5 and later and Fable have 1,000,000;
Gemini 2.5 and 3 have 1,048,576. Sonnet 4.x and Opus 4.6 also run as an opt-in
one-million variant (`[1m]`) that Claude transcripts do not record, so their
window is unknown and they have `window_tokens: null` rather than a guess. Any
other model has `window_tokens: null` too, and Town shows no bar for it. A
reading never says zero or full on missing evidence.

Town reads `contexts` every 30 seconds while it or an agent window is shown:
the peek and the window bar show the fill, and an agent at 85% or more looks
tired at its desk; see FEATURES.md.

## Town expenses boards

Town reads `world.usage.get` for its boards (`web/src/world/town/townExpenses.ts`):

Economy amounts use the bundled JetBrains Mono font with tabular digits on the
city, reception, room/table and Town boards, including compact phone signs.

- All Town economy figures share one seven-day service observation, including
  its today projection. The Town board's **Economy today · UTC · harness logs**
  uses exactly the city board's Today total and local price-table rule. The
  metrics provider is not used for this line. Both windows turn at UTC midnight;
  seven days contains today and six previous dates.
- The city billboard shows `total` for the chosen window, plus `unattributed`
  (usage tied to no pane). A building's reception board shows that host's `host` rollup
  and its three costliest `workspace` rollups (by cost when all are priced,
  otherwise by tokens), plus the host's no-workspace subtotal as
  unattributed. Each figure is one rollup level; levels are never added.
  Building totals sum to the city total. Unattributed means no uniquely linked
  current pane/room; it is already included, not another charge to add. Closed
  sessions can legitimately remain unattributed. Stale hosts contribute to neither
  window's current figures. A limited detail list says so without reducing totals.
- A reception's expenses use the connection's newest runtime generation in the read
  and never another connection's numbers.
- Stale entities stay out of the figures; the board says "stale left out". A
  partial source or a truncated read says "partial", and hosts with no data
  "1 host missing". Each Town expense figure prints these as one short caveat
  line; its tooltip (a tap on a phone) explains each in full, including the
  unattributed subtotal and a limited detail list, which are not printed.
- A null cost stays null: "no price table" when no counted row has a table
  version, otherwise "some models unpriced".
- A host with no available or partial source reads "no data", and the city
  board counts such hosts. A readable host with no records reads "none
  recorded". Neither is shown as zero.
- A failed re-read keeps the last read for at most five minutes, and never
  past the service's UTC midnight (its `observed_at` day plus the time since
  the read arrived), since both windows turn there. After that the boards
  and room cards read "out of date" and show no figures until a read
  succeeds.
- Boards re-read about once a minute while Town shows them and when the page
  regains focus or becomes visible; the shared store sends at most one read
  per window every 30 seconds.

Tests use the synthetic fixture in `web/src/world/testing/usageFixture.ts`,
which shapes reads like the service with example hosts, models and rates.
With `?scene=town-scale`, all Town economy readers use one synthetic observation
for the scene's Atlas, Nova and Zephyr buildings, including the Town board,
city billboard, reception expenses, room/table cards and Spend lens. The boards
say **TEST DATA**. Atlas and Nova sum to the city; Zephyr deliberately has no
data. Seven days is twice today's usage, and all estimates use the same
synthetic price table. No live usage read supplies these figures. Remove
`scene=town-scale` and reload to return to the connected hosts and their usage.

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
most 128 detail entities, with a 768 KiB response budget below the 1 MiB frame.
Totals and rollups are computed from all admitted hosts' collected rows first.
Response capacity sets `details_truncated` and can omit non-host rollups, while
preserving city/host totals, host unattributed subtotals and both UTC windows.
Collection bounds still set `truncated` and disclose incomplete source coverage.
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

## Testing Town economy in a preview

Open the preview's Town with `?town-economy-preview=busy` appended to its URL.
The parameter is removed immediately and all expense boards say **TEST DATA**;
only this page load uses synthetic usage on the connected buildings. With at
least two connections, City expenses and Economy today show **1.2M tokens**;
the first two buildings show **900k** and **300k**, and seven days shows **1.8M**.
With one connection its building shows the full 1.2M. Hover or tap a board's
caveat line for **180k tokens unattributed**, a subtotal already included,
and a synthetic stale record stays out of totals.
This fixture includes cache tokens and Claude/Codex usage; it does not alter
agents, transcripts, settings or services.

Use `?town-economy-preview=unpriced` for **some models unpriced**, or
`?town-economy-preview=no-table` for **no price table** on both main boards.
Use `?town-economy-preview=midnight` to start just before UTC midnight: within
30 seconds both windows and the Economy line read out of date together.
Reload the URL without the parameter to return to live usage.
