# World usage

## Purpose

Collect private numeric harness usage, limits and context with explicit
attribution, freshness, retention and pricing boundaries for every World view.

Collection serves supported Unix Herdr TUI and herdr-core connections, local or over SSH.
Windows usage tools remain unsupported; runtime support is recorded
in the [support table](../../../FEATURES.md#runtime-support). The
[usage guide](../../../docs/usage.md) owns source formats and operational limits.

## Requirements

### Requirement: Numeric usage entities from host connectors

World SHALL collect usage by default from available Claude, Codex, Pi and Gemini session files through each service-owned local or SSH runtime.

#### Scenario: Numeric usage identity, privacy and bounds

- **WHEN** World collects harness usage
- **THEN** Usage SHALL be view-neutral World entities, with deterministic digest-derived identity, source provenance, qualified connection ID and runtime generation. Published observations SHALL contain only validated numeric counters, model identifiers, timestamps and opaque attribution/deduplication evidence, never conversation content, transcript paths, native session IDs or raw source errors. A bounded private parser/offset cache MAY retain file metadata on its own transcript host, never content, and SHALL be dropped on runtime generation change. Reads SHALL NOT allocate durable ID records. Unsupported formats and missing prerequisites SHALL be explicit.

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

The read contract SHALL offer today and seven UTC calendar days including today as half-open bounded windows.

#### Scenario: Usage windows, deduplication and coverage

- **WHEN** World aggregates numeric usage
- **THEN** Per-message/turn identity SHALL prevent repeated Claude/Pi/Gemini usage from counting twice; Codex cumulative counts SHALL contribute only known nonnegative deltas, without assigning an unknown baseline to a model or window. Daily session/model rollups SHALL retain at most seven days. Response and collection bounds SHALL be fixed and any loss of coverage SHALL be explicit, with each response below the 1 MiB frame. Time SHALL mean usage-observation span, not active or billable time.

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

Tokens SHALL remain visible independently of pricing.

#### Scenario: Usage prices and telemetry overlap

- **WHEN** World reports usage and optional telemetry
- **THEN** USD cost SHALL be labelled an estimate from disjoint token categories and an explicit versioned local exact-model price table; missing/unknown rates SHALL produce null rather than zero or an invoice claim. Logs SHALL win for matching harness message/turn identity. Unidentified overlapping OTel totals SHALL be labelled comparisons and excluded from totals. OTel totals MAY contribute for an explicitly identified scope with no log connector coverage. Missing, stale, partial and unsupported source states SHALL remain visible to every view consuming the shared response.

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

The usage read SHALL report, per qualified host, the newest subscription-limit observation each supported harness persists on that host: each window's length, percent used and reset time, and the observation time.

#### Scenario: Limit data privacy and freshness

- **WHEN** World reads subscription-limit observations
- **THEN** It SHALL carry no account IDs, plan names, credit balances, credentials, prompts, paths or raw provider errors. An observation older than three hours or past any window's reset SHALL be stale; a host with no observation SHALL be missing; a harness that persists no usable limits record SHALL be unsupported with a fixed reason. None of these SHALL be presented as zero or full.

#### Scenario: Codex reports limit windows
- **WHEN** a Codex rollout on a host records token counts with primary and secondary rate-limit windows
- **THEN** that host's limits list both windows from its newest such record, attributed to the Codex session log

#### Scenario: Multiple Claude sessions report one reset window

- **WHEN** Claude taps report comparable percentages with the same reset time
- **THEN** the host observation retains the highest percentage for that window;
  a later reset replaces an earlier window and an older reset cannot restore it
- **AND** absent reset evidence remains incomparable rather than an invented
  monotonic window; contention may skip an optional reading

[Q55](../../../verification/contracts/claude-tap-lock.md) checks the repaired
publication protocol with positive model and real-filesystem conformance; the
original issue #1086 counterexample remains a rejected fault control.

#### Scenario: Unix TUI Claude launch prepares settings

- **WHEN** World launches Claude through a Unix TUI shell
- **THEN** it prepares only its generated tap settings as a private,
  content-addressed file on the selected local or SSH host over a non-PTY
  process and passes a short `--settings` path; user settings stay unchanged
- **AND** preparation or path validation failure prevents tab creation and
  agent launch; retry can reuse a complete prepared file, while concurrent
  equal-content preparations publish the same complete content atomically
- **AND** Windows retains inline settings and core retains its native argv path

#### Scenario: Usage-limit stop and stale fuel display

- **WHEN** a current transcript reports a usage-limit refusal or a limit reading ages
- **THEN** a stopped agent's out-of-fuel explanation derives from that current
  refusal, and a gauge older than fifteen minutes shows its age; past its
  source's short age (thirty minutes) its levels dim, it reads "as of" its
  observation time and it never raises the low indicator alone; the existing
  three-hour and reset rules still determine staleness, and missing is never full

#### Scenario: Fuel names what it cannot show
- **WHEN** a current reading lacks one of its harness's windows, or a harness
  has agents in Town and no reading from any host
- **THEN** the gauge names the absent window as not reported, and Town names
  the harness as having no reading yet, each with what refreshes it, rather
  than leaving either out

#### Scenario: Claude sessions outside World report through the installed tap
- **WHEN** the user explicitly installs the Claude World integration and starts a new Claude session without a project status line override
- **THEN** the chained status line records the same numeric limits as the per-launch tap and preserves the previous command's input and output; uninstall restores unchanged settings byte for byte, including absence, while preserving intervening user edits

#### Scenario: Claude reports limit windows through World's status line tap
- **WHEN** World starts a Claude agent and Claude Code passes rate limits to that agent's status line
- **THEN** a per-launch status line command records the five-hour and weekly windows on that host and runs the user's own status line command with its output unchanged, without writing the user's Claude settings files, and that host's limits list both windows attributed to the Claude status line

#### Scenario: Claude refuses work at its limit
- **WHEN** the newest Claude limit record on a host is a usage-limit refusal whose reset is in the future
- **THEN** that host's Claude limit reports the limit reached until that reset, attributed to the Claude transcript, with no percent, and becomes stale once the reset passes

#### Scenario: Concurrent Claude taps retain comparable maxima through publication
- **WHEN** Claude sessions publish readings with the same reset time, including a writer suspended immediately before replacing the limits file
- **THEN** committed comparable readings never decrease; a later reset starts fresh and an earlier reset never replaces a later one

#### Scenario: A Claude tap owner is suspended or dies
- **WHEN** another tap encounters an owned limits transaction
- **THEN** elapsed age alone never authorizes reclamation; a live or unverifiable owner retains ownership through file publication, a confirmed-dead owner can be recovered without removing a replacement owner's lock, and contention skips the optional reading after a bounded half-second wait while preserving the user's status command

#### Scenario: Limits age or disappear
- **WHEN** the newest observation passes a window's reset, grows old, cannot be refreshed, or its logs are removed
- **THEN** it is reported stale, or missing once a successful read finds none, and Town shows stale or no gauge rather than a level


### Requirement: Fresh uniquely attributed context fill

World SHALL report a pane's newest main-thread prompt size only for the one
session uniquely bound to it on a fresh qualified observation.

#### Scenario: Context attribution and numeric projection

- **WHEN** World reports context fill
- **THEN** Context size
  SHALL include applicable cache input and exclude output, sidechains, API errors,
  synthetic messages and future-dated records. The window SHALL come from the
  harness's report or an explicit model-name table; an unknown model or unresolved
  window SHALL remain unknown. Only numeric sizes, model names, timestamps and
  opaque digests SHALL leave the transcript host.

#### Scenario: Ambiguous or stale context
- **WHEN** a session has duplicate pane claims, its host is stale, or its runtime
  generation retires during collection
- **THEN** no fresh pane context entry is published and missing context is not zero

#### Scenario: Unknown context window
- **WHEN** a fresh uniquely bound session reports a prompt size without a known window
- **THEN** the prompt size remains available without an invented window or fill percentage

### Requirement: Shared usage analytics read

World SHALL provide `world.usage.analytics` and the authenticated local CLI
`usage` read over the same numeric harness evidence.

#### Scenario: Analytics aggregation and unknown values

- **WHEN** World reads shared usage analytics
- **THEN** It SHALL aggregate before
  legacy detail clipping and group by agent, Git project, qualified room, UTC
  day or run (one harness session on one transcript host) for today or seven UTC
  calendar dates. Metrics SHALL distinguish unknown
  from observed zero and disclose partial coverage. Optional explicit harness
  cost SHALL remain separate from configured price estimates and SHALL NOT imply
  a subscription charge or invoice. Stale numeric rows SHALL NOT enter totals.

#### Scenario: Unknown cost and no time evidence
- **WHEN** logs expose tokens without dollar charges or observed runtime status intervals
- **THEN** tokens remain visible and reported cost, active time and owner-wait time are null with unknown coverage

#### Scenario: Run detail without prompt text
- **WHEN** a caller groups by run
- **THEN** each run row carries its source, harness, models, response count with each API response counted once, first and last response times, largest prompt, bounded spans when it was going (responses at most ten minutes apart, joined with the intervals World observed its agent working, which join only where they touch so an observed idle gap is never working time), checkout branch, its pull request and how it was attributed, and its pane's current context, and a role only from a fixed vocabulary matched in the run's first prompt, never the prompt text; a run whose first prompt names no role has an unknown role

#### Scenario: Harness without a token reader
- **WHEN** World observes an agent of a supported harness whose session logs no usage reader reads, or whose log has no run yet
- **THEN** its observed active and waiting-on-you time still count, it appears as a run of its own measured by World, and its response count, largest prompt, tokens and cost are null (not available), never zero

#### Scenario: Pull request attribution
- **WHEN** a run's pull request is attributed
- **THEN** only a work link validated by the pane's own agent session and naming exactly one pull request names it, and is kept with the run; a branch alone never names one, because it carries no repository: when a catalogue pull request has the run's branch but no such link proves it, the pull request is unknown and marked ambiguous, never the most recently updated or the only match

#### Scenario: Same host through two runtime connections
- **WHEN** TUI and core connections are known to read the same transcript host
- **THEN** each session/day/model counts once; conflicting current claims remain unattributed, while physical equality of distinct SSH aliases is not invented

### Requirement: Observed time with explicit gaps

World SHALL count only observed working and blocked status intervals as active
and waiting-on-you time, respectively; idle SHALL NOT imply owner wait.

#### Scenario: Observed time expiry and history

- **WHEN** World counts status intervals
- **THEN** An
  explicit usage-limit block SHALL NOT count as owner wait. Status continuity
  SHALL expire after at most fifteen seconds without fresh observation and SHALL
  end on semantic invalidation, disconnect or generation retirement. Numeric
  daily history SHALL be bounded to seven UTC dates and 8,192 rows. Open intervals
  SHALL NOT resume after restart. Corrupt/unavailable history and capacity loss
  SHALL be explicit. Transcript observation span SHALL remain separate.

#### Scenario: Repeated reads, midnight and restart
- **WHEN** an interval crosses UTC midnight, is read twice and the service restarts
- **THEN** time splits by day, counts once and never accrues during the unobserved restart gap

### Requirement: Bounded attribution and PR events

Analytics SHALL derive opaque project identities from qualified Git common
directories, group linked worktrees on that connection together, and leave
unresolved projects unknown.

#### Scenario: Analytics attribution and PR evidence

- **WHEN** World attributes analytics or PR events
- **THEN** At most 32 distinct checkouts SHALL be resolved,
  four at a time. Agent/room/project evidence SHALL be revalidated after async
  reads and SHALL NOT attach to changed sessions or retired generations.
  Known authored PR creation and merge timestamps SHALL count distinct events
  from the existing work-source catalogue; agent association SHALL require one
  matching current session-qualified link. Missing dates, shared links and
  incomplete source history SHALL NOT imply zero or proven agent authorship.

#### Scenario: Session changes during project lookup
- **WHEN** the program, room or checkout changes before lookup completes
- **THEN** the previous observation cannot attribute usage to the replacement

#### Scenario: One PR linked to multiple agents
- **WHEN** several current agent links claim one authored PR
- **THEN** its creation/merge counts once globally and remains agent-unattributed

### Requirement: Analytics bounds, privacy and refusals

Analytics SHALL publish no native sessions, transcript contents, filesystem
paths, credentials, account identifiers or raw source errors.

#### Scenario: Analytics privacy, query and response bounds

- **WHEN** World serves analytics queries
- **THEN** Project labels
  MAY contain a checkout basename. Response rows SHALL be capped at 512 within
  768 KiB, with totals computed before clipping and explicit truncation. Queries
  SHALL refuse unsupported keys/windows/grouping, arbitrary paths and unqualified
  pane/room selectors; connection filters SHALL name both immutable ID and
  generation. A CLI-only synthetic fixture SHALL exercise known time/tokens/PRs,
  unknown dollars and a subscription limit without provider or service I/O.

#### Scenario: Unqualified or injected query
- **WHEN** a caller supplies a pane without connection identity or a transcript path/fixture API parameter
- **THEN** the read refuses rather than selecting a default runtime or reading caller-selected files
