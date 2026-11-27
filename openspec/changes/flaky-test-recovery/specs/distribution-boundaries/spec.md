## ADDED Requirements

### Requirement: Accountable flaky test recovery
CI SHALL retry each failed unit test file or browser case at most once in its existing job, without rerunning passing files or unrelated browser cases. A recovered test SHALL pass its job and appear in the Delivery checks summary with its file and case. A second failure SHALL fail the job. Model, static, privacy and PR-description checks SHALL never retry.

#### Scenario: One transient failure
- **WHEN** a unit file or browser case fails initially and succeeds on its sole retry
- **THEN** its job succeeds and Delivery checks lists each recovered file and case as flaky
- **AND** only failed files or cases consume retry test execution

#### Scenario: Failure persists or recovery evidence is missing
- **WHEN** the retry fails or does not prove the failed test executed successfully
- **THEN** the job fails

#### Scenario: Non-test check fails
- **WHEN** a model, static, privacy or description check fails
- **THEN** no flaky-test retry runs

### Requirement: Flaky test accountability
CI SHALL maintain one open issue labelled flaky per recovered file/case from same-repository CI runs, updating each distinct run occurrence with its run link. Delivery checks SHALL enforce the frequency limit using recorded history plus its current run, until the issue is closed after a fix or the owner explicitly quarantines it. Asynchronous accounting SHALL use only an optional Flaky accounting status, never Delivery checks, and SHALL never block a merge.

#### Scenario: A cause recurs
- **WHEN** a recovered test already has an open flaky issue
- **THEN** its new run is recorded in that issue without opening another
- **AND** rerunning the same run SHALL count once

#### Scenario: Fourth run in seven days
- **WHEN** the source Delivery job observes an unquarantined open cause reaching a fourth distinct run within seven days in recorded history plus its current run
- **THEN** Delivery checks fails, including later runs that select the affected file until fixed or explicitly quarantined

#### Scenario: Accounting is queued or unavailable
- **WHEN** a source Delivery checks check run succeeds while trusted accounting is pending, late, failed or missing
- **THEN** accounting SHALL publish no Delivery checks commit status and SHALL not delay merge eligibility
- **AND** Flaky accounting SHALL remain outside the required ruleset checks

#### Scenario: Missed or interrupted accounting
- **WHEN** a later completed event processes retained same-repository CI evidence
- **THEN** the trusted tracker SHALL reconcile previously unaccounted completed runs within artifact retention, including their retained attempts
- **AND** it SHALL record each run once in flaky history and acknowledge each accounted attempt only after durable issue updates
- **AND** an error for one run SHALL not prevent accounting for other completed runs within the bounded batch

#### Scenario: Retained history exceeds a single accounting batch
- **WHEN** retained CI history contains many already accounted runs or an unaccounted backlog
- **THEN** the tracker SHALL use run-list metadata and a trusted receipt cache without fetching each settled run or its commit statuses
- **AND** short nonterminal run-list pages SHALL not end discovery
- **AND** each event SHALL account at most eight runs, prioritizing its triggering run and then the oldest missed evidence, with at most 80 API requests including artifact downloads
- **AND** failed batches SHALL advance a durable scan cursor so unavailable evidence cannot starve later missed runs
- **AND** subsequent completions SHALL continue the backlog, while a lost cache reply or cache rebuild SHALL not duplicate flaky occurrences

#### Scenario: Explicit owner resolution
- **WHEN** the owner closes a fixed cause or labels its open issue flaky-quarantined
- **THEN** that issue no longer blocks the frequency limit
- **AND** a later recovered failure after closure creates a new open issue
- **AND** quarantine SHALL exempt only the frequency limit and SHALL never permit a test that fails twice to pass

#### Scenario: Trusted source admission
- **WHEN** the trusted tracker handles a source CI run
- **THEN** it SHALL independently verify the source head repository through the Actions API before reading issue history or writing issues or statuses
- **AND** missing source repository identity SHALL be rejected

#### Scenario: Fork or unidentified source run
- **WHEN** a source CI run belongs to a fork or its head repository identity is missing
- **THEN** the trusted tracker SHALL skip fork runs before downloading artifacts
- **AND** the workflow skips tracking before artifact download
- **AND** direct tracker invocation rejects that source without reading issue history or writing issues or statuses, for both requested and completed events
