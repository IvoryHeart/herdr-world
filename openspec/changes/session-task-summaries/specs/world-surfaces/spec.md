## ADDED Requirements

### Requirement: Publish session-qualified task summaries

The packaged `herdr-world task-summary` command SHALL report the `task_summary` metadata token for one explicitly identified Herdr pane without starting the World web service. A report SHALL include a second token containing a fingerprint of that pane's exact active Herdr agent-session identity; World SHALL admit the summary only while the current session matches it. The command SHALL use `--pane` or `HERDR_PANE_ID` and SHALL never infer a pane from another host or the currently focused browser view. It SHALL support the existing Herdr session selection and fixed-policy SSH transport when those are explicitly requested. It SHALL NOT offer post-session Clear because Herdr has no conditional delete of these pane-global token keys by expected session.

#### Scenario: Report current work

- **WHEN** a harness reports `Reviewing CI` for a pane with an active agent session
- **THEN** Herdr receives a summary for that exact pane and session, and Office, Tree, Graph and the Inspector show the admitted text after observation refresh

#### Scenario: Delayed cleanup from an older session

- **WHEN** session B has reported after session A and a delayed A hook invokes `herdr-world task-summary --clear` for that pane
- **THEN** Clear is rejected before any Herdr metadata request and B's summary and session fingerprint remain intact

#### Scenario: Pane or session is unavailable

- **WHEN** a report names a missing pane, a pane without an active agent session, an unsupported Herdr metadata method or an unreachable SSH destination
- **THEN** the command fails with a bounded explanation and does not report a summary to another pane, connection or session

#### Scenario: Agent session is replaced

- **WHEN** a pane starts another agent session after a summary was reported
- **THEN** the old summary is not presented as the new session's current work, even if Herdr has not yet expired its tokens, including across reconnect and delayed observation replies

### Requirement: Bound task-summary content and lifetime

A report SHALL normalize whitespace, reject empty text, replace obvious credential-shaped values, and cap its reported text to 80 Unicode characters in accordance with Herdr 0.9.0's token value limit. The default time to live SHALL be 900,000 milliseconds; an explicit time to live SHALL be an integer from 1 through 86,400,000 milliseconds. The summary and fingerprint tokens SHALL receive the same TTL. A report result SHALL identify its target and outcome without echoing summary text or credential material into output or logs. Expiry SHALL remove the summary without browser action.

#### Scenario: Summary contains a credential-shaped value

- **WHEN** a harness reports text containing a bearer token, common API key or password assignment, or recognized provider-token shape
- **THEN** the value is replaced before it reaches Herdr or a browser and the result output does not contain it

#### Scenario: Summary expires

- **WHEN** the configured lifetime elapses without a newer report for that same session
- **THEN** Herdr removes the token and World stops displaying the expired summary after observation refresh

#### Scenario: Report options are invalid

- **WHEN** the command receives empty text, an out-of-range lifetime, `--clear` or no pane identity
- **THEN** it exits with a usage error before making a Herdr request
