## ADDED Requirements

### Requirement: Accountable flaky test recovery
CI SHALL retry each failed unit test file or browser case at most once in its existing job, without rerunning passing files or unrelated browser cases. A recovered test SHALL pass its job. A second failure SHALL fail the job. Model, static, privacy and PR-description checks SHALL never retry.

#### Scenario: One transient failure
- **WHEN** a unit file or browser case fails initially and succeeds on its sole retry
- **THEN** its job succeeds and lists the retried file and case in its own summary
- **AND** only failed files or cases consume retry test execution

#### Scenario: Failure persists or recovery evidence is missing
- **WHEN** the retry fails or does not prove the failed test executed successfully
- **THEN** the job fails and any attempted retry remains reportable

#### Scenario: Non-test check fails
- **WHEN** a model, static, privacy or description check fails
- **THEN** no flaky-test retry runs

### Requirement: Informational daily flaky test reporting
Existing CI test jobs SHALL write their retried tests into job summaries and small flaky.json artifacts, including retries that fail again. The existing Delivery job SHALL consolidate shard evidence into one flaky.json artifact per run attempt. Reporting SHALL never gate a job, PR or merge, read issue history for a merge verdict, or publish commit statuses. The ruleset SHALL require only the Delivery checks check run.

#### Scenario: Reporting is unavailable or a test recurs
- **WHEN** retry history recurs any number of times, or summary, artifact or daily issue reporting fails or is late
- **THEN** reporting SHALL NOT change the test verdict or delay merge eligibility after Delivery checks succeeds

#### Scenario: No per-run accounting workflows
- **WHEN** any CI run starts or completes, including cancellation or skipping
- **THEN** no flaky-test workflow SHALL start from workflow_run events
- **AND** no pending or final accounting commit status SHALL be published

### Requirement: One daily trusted retry report
One daily scheduled workflow, also available through workflow_dispatch, SHALL read flaky.json artifacts from completed CI runs created in the last 24 hours on this repository's branches and update a single Flaky tests tracking issue. Each test SHALL list its retry count and a link to its latest run. Cancelled, skipped, fork and unidentified source runs SHALL be excluded before artifact download.

#### Scenario: Trusted report publication
- **WHEN** the daily or manual report runs
- **THEN** it SHALL execute default-branch code, treating artifacts only as validated data
- **AND** only this serialized workflow SHALL have issue-write permission; candidate CI reporting SHALL require no issue or status writes
- **AND** concurrent requests SHALL coalesce to one active and at most one pending report

#### Scenario: Repeated evidence and manual reruns
- **WHEN** a test occurs in multiple shard reports for one run attempt, or the daily report is run again
- **THEN** each run attempt SHALL count once for that test in the 24-hour snapshot
- **AND** repeated reports SHALL update the same issue, preserving owner text outside its managed report
- **AND** different attempts of a run SHALL count separately

#### Scenario: Short pages or unavailable evidence
- **WHEN** CI run discovery returns short intermediate pages or one source artifact cannot be read
- **THEN** discovery SHALL continue until an empty page and other runs SHALL still be reported
- **AND** unavailable evidence SHALL be visible in the daily issue and daily job failure, with manual rerun recovery independent of CI or merge verdicts
