## ADDED Requirements

### Requirement: Numeric usage entities from host connectors

World SHALL collect usage by default from available Claude, Codex, Pi and Gemini session files through each service-owned local or SSH runtime. Usage SHALL be view-neutral World entities, with deterministic digest-derived identity, source provenance, qualified connection ID and runtime generation. Published observations SHALL contain only validated numeric counters, model identifiers, timestamps and opaque attribution/deduplication evidence, never conversation content, transcript paths, native session IDs or raw source errors. A bounded private parser/offset cache MAY retain file metadata on its own transcript host, never content, and SHALL be dropped on runtime generation change. Reads SHALL NOT allocate durable ID records. Unsupported formats and missing prerequisites SHALL be explicit.

#### Scenario: Default collection without OTel
- **WHEN** a host has readable supported harness logs and no OTel configuration
- **THEN** World returns numeric usage with harness-log provenance and no telemetry setup requirement

#### Scenario: SSH collection
- **WHEN** an SSH host is collected
- **THEN** only its qualified connection executes the numeric projection and only the numeric result crosses that connection; missing tooling never selects local files

### Requirement: Exact attribution and runtime fencing

Usage SHALL identify its host and SHALL name pane, tab and workspace only with one unique current session/file binding. Unlinked and multiply claimed sessions SHALL count at host level as unattributed. Stale/offline observations and retired generations SHALL NOT produce fresh attributed usage. Source absence SHALL NOT imply measured zero.

#### Scenario: Session without pane evidence
- **WHEN** a discovered Codex session has no uniquely known current pane
- **THEN** its numbers count once at its host with null pane, tab and workspace

#### Scenario: Runtime changes during collection
- **WHEN** collection finishes after its runtime lease retires
- **THEN** no collected result is published as fresh or attributed to the replacement runtime

#### Scenario: Attribution inventory is incomplete or changes
- **WHEN** the supplied agent count exceeds the attribution budget or a complete revalidation observes a changed, new or conflicting claim
- **THEN** usage remains host-attributed and candidate-budget truncation is explicit rather than implying unique pane ownership

#### Scenario: An older session conflicts with a current title prefix
- **WHEN** a Codex session file outside numeric retention shares the current displayed prefix with another session
- **THEN** its identity still participates in ambiguity checks, recent usage remains host-attributed, and expired token rows do not enter totals

#### Scenario: Older identity evidence cannot be completed
- **WHEN** older Codex metadata is pruned, unavailable or exceeds bounded discovery capacity
- **THEN** the prefix remains unresolved; pruned numeric history cannot prove unique identity, and failures or exhausted capacity disclose incomplete coverage

### Requirement: Counted-once windows and retention

The read contract SHALL offer today and seven UTC calendar days including today as half-open bounded windows. Per-message/turn identity SHALL prevent repeated Claude/Pi/Gemini usage from counting twice; Codex cumulative counts SHALL contribute only known nonnegative deltas, without assigning an unknown baseline to a model or window. Daily session/model rollups SHALL retain at most seven days. Response and collection bounds SHALL be fixed and any loss of coverage SHALL be explicit, with each response below the 1 MiB frame. Time SHALL mean usage-observation span, not active or billable time.

#### Scenario: Repeated and mixed-model records
- **WHEN** the same response appears twice or cumulative Codex snapshots repeat around a model switch
- **THEN** the response counts once and only a known delta is assigned to its observed model

#### Scenario: Cumulative counters recover after a decrease
- **WHEN** a session's cumulative counters decrease or a copied prefix is replayed before recovering
- **THEN** no already covered usage counts again and only proven increments beyond the prior high-water baseline contribute

#### Scenario: A transcript starts with a preamble
- **WHEN** a preamble precedes the canonical session identity in copied transcript files
- **THEN** both copies feed one session reader with response deduplication and exact ID attribution

#### Scenario: Repeated reads and appends
- **WHEN** a transcript is unchanged or gains complete JSONL records
- **THEN** its host-local reader reuses numeric parser state, checks bounded head/offset samples on changes and parses appended bytes; a failed sample, shrink, inode change or backward mtime rebuilds the affected session, and each UTC day forces a full rebuild within entry and byte bounds

#### Scenario: Admission changes before open
- **WHEN** an admitted file or parent is replaced before reading, including a JSON or compressed input
- **THEN** a non-following descriptor must match admitted identity and containment before any bytes are parsed, and input bounds apply on that descriptor

#### Scenario: A budget interrupts cached collection
- **WHEN** a line or host-work budget stops collection before processing all bytes or cached sessions
- **THEN** truncation is explicit, unprocessed bytes remain retryable, and parser retirement cannot leave a complete cursor that silently skips rebuilding

#### Scenario: Current activity in an older Codex date
- **WHEN** a session in an older dated tree has recent file activity
- **THEN** bounded metadata discovery can find its current usage after restart; exhausted discovery reports partial/truncated coverage and incomplete identity cannot prove title-prefix uniqueness

#### Scenario: A persistent reader fails while idle
- **WHEN** a reply is malformed, numerically invalid or unsolicited after a completed request
- **THEN** the reader stops and reaps its owned channel without requiring a future request or explicit runtime close

#### Scenario: Cancellation or output overflow
- **WHEN** collection is cancelled, exceeds its owned deadline, or crosses either subprocess stream bound
- **THEN** its worker or subprocess is terminated and reaped, blocked work cannot retain replacement or shutdown progress, and no retired result becomes fresh usage

#### Scenario: UTC reset
- **WHEN** UTC midnight passes
- **THEN** today's totals use the new day while the previous day's rollup remains available within the seven-day window

### Requirement: Honest prices and optional telemetry

Tokens SHALL remain visible independently of pricing. USD cost SHALL be labelled an estimate from disjoint token categories and an explicit versioned local exact-model price table; missing/unknown rates SHALL produce null rather than zero or an invoice claim. Logs SHALL win for matching harness message/turn identity. Unidentified overlapping OTel totals SHALL be labelled comparisons and excluded from totals. OTel totals MAY contribute for an explicitly identified scope with no log connector coverage. Missing, stale, partial and unsupported source states SHALL remain visible to every view consuming the shared response.

#### Scenario: Unknown price
- **WHEN** usage names a model absent from the local price table
- **THEN** its tokens are present and estimated cost is null

#### Scenario: Overlapping telemetry
- **WHEN** OTel reports usage already covered by a log event or reports an aggregate without sufficient disjoint-scope evidence
- **THEN** the log counts once and the unidentified aggregate remains a labelled comparison outside totals

#### Scenario: Source unavailable after success
- **WHEN** a source that previously succeeded cannot be refreshed
- **THEN** its retained bounded observation is explicitly stale and is never presented as fresh zero

### Requirement: Subscription limit observations

The usage read SHALL report, per qualified host, the newest subscription-limit observation each supported harness persists on that host: each window's length, percent used and reset time, and the observation time. It SHALL carry no account IDs, plan names, credit balances, credentials, prompts, paths or raw provider errors. An observation older than a few hours or past any window's reset SHALL be stale; a host with no observation SHALL be missing; a harness that persists no usable limits record SHALL be unsupported with a fixed reason. None of these SHALL be presented as zero or full.

#### Scenario: Codex reports limit windows
- **WHEN** a Codex rollout on a host records token counts with primary and secondary rate-limit windows
- **THEN** that host's limits list both windows from its newest such record, attributed to the Codex session log

#### Scenario: Limits age or disappear
- **WHEN** the newest observation passes a window's reset, grows old, cannot be refreshed, or its logs are removed
- **THEN** it is reported stale, or missing once a successful read finds none, and Town shows stale or no gauge rather than a level

