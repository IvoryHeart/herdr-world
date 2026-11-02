# Harness usage data

World collects token usage on demand from supported harness session files by
default. The service owns the numeric records; Town and Board can both read
`world.usage.get`. This data API is the foundation for the expenses boards in
issue #213. Existing Town Summary spend controls still use their configured
metrics provider.

## Sources and inventory

The implementation inventory on 2026-11-02 found Claude Code 2.1.316, Codex CLI
0.166.0, Pi 0.87.1 and Gemini CLI 0.57.0 installed. Version commands and installed
Gemini recorder code were inspected; local collection returned numeric records
with disclosed partial coverage. No real session paths, IDs or conversation
content were copied into this guide or fixtures. SSH transport is exercised
with synthetic host programs, not claimed as a live fleet inventory.

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

Local collection runs in an owned worker in the service's Bun runtime. SSH collection sends the same
numeric projection program through the owning OpenSSH destination and requires
Bun or Node on that host. Node zstd support is optional; without a decoder,
compressed sources report partial coverage. Remote failures never read this
machine's files. Harness roots honor `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and
`PI_CODING_AGENT_DIR` on the transcript host. Exact files resolved from current
agent session evidence receive inventory capacity first. File identity is read
before projection, so preambles and copied files cannot create independent
readers for one known session. Plain prefixes are replayed within the read
budgets; compressed/JSON materialization is reused within that file's worker.

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

- `entities`: store-issued `usage` IDs, connector, harness, exact model, UTC day,
  numeric counters, response count, first/last observation, estimate and source
  health. IDs remain stable for retained entities during one service incarnation.
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

JSON is decoded transiently on the transcript host. Only hashed source/session
evidence, model identifiers, timestamps and validated numeric counters survive
projection. SSH transfers that projection, never transcript contents. The API
returns no paths, native session IDs, prompts, replies, reasoning, tool content
or raw filesystem/SSH errors. The service keeps no usage transcript archive.

Collection admits at most 128 exact bound files plus ordinary inventory within
a 384-file cap, with 64 ordinary files and 2,048 directory entries per harness.
Depth is at most eight. Reads have a 10-second work budget, 64 MiB per plain or
decoded file, 16 MiB per compressed/JSON input, 256 MiB plain/input host budget,
500,000 lines and 32,768 response identities per session. Oversized/incomplete
lines, unreadable files and exhausted capacity are disclosed. Daily rollups
retain at most seven UTC dates, 1,024 rows and a 512 KiB numeric host response.

The service refreshes on reads, at most once per 30 seconds per runtime, with
up to four collectors concurrently and a two-second wait before returning the
current observation plus `refreshing`. It admits 16 connections and returns at
most 128 entities plus their rollups, with a 768 KiB response budget below the
1 MiB frame. Bounds set `truncated`; totals describe the returned entities.
Fixed counts and deadlines bound work and do not promise full host history.
Store ID reservations survive restart; numeric caches and bindings do not.

One owned 20-second operation deadline covers identity discovery, collection,
decompression and claim revalidation. Runtime retirement, replacement and
service shutdown abort that work. Local workers terminate and report exit even
when a filesystem promise is blocked. SSH keeps an input lifetime channel open;
closing it ends the remote program. The service bounds stdout at 768 KiB and
stderr at 16 KiB while reading, and kills and reaps the owned SSH process on
overflow, cancellation or failure. A replacement generation starts independently
of its cancelled predecessor; shutdown drains the owned resources before
finishing. A still-current source that times out reports unavailable and retains
its last bounded numbers as stale, outside current totals.
