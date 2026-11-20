## ADDED Requirements

### Requirement: Shared usage analytics read

World SHALL provide `world.usage.analytics` and the authenticated local CLI
`usage` read over the same numeric harness evidence. It SHALL aggregate before
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
and waiting-on-you time, respectively; idle SHALL NOT imply owner wait. An
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
unresolved projects unknown. At most 32 distinct checkouts SHALL be resolved,
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
paths, credentials, account identifiers or raw source errors. Project labels
MAY contain a checkout basename. Response rows SHALL be capped at 512 within
768 KiB, with totals computed before clipping and explicit truncation. Queries
SHALL refuse unsupported keys/windows/grouping, arbitrary paths and unqualified
pane/room selectors; connection filters SHALL name both immutable ID and
generation. A CLI-only synthetic fixture SHALL exercise known time/tokens/PRs,
unknown dollars and a subscription limit without provider or service I/O.

#### Scenario: Unqualified or injected query
- **WHEN** a caller supplies a pane without connection identity or a transcript path/fixture API parameter
- **THEN** the read refuses rather than selecting a default runtime or reading caller-selected files
