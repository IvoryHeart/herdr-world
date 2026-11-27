## Why

Whole-step retries repeat passing tests and conceal recurring failures. Issue #1421 authorizes bounded test recovery with visible, durable accountability.

## What Changes

- Retry only failed unit files or browser cases once within their existing job.
- Report recovered cases and track one open flaky issue per file/case.
- Block recurring flakes after three distinct runs in seven days until fixed or explicitly quarantined.
- Remove behavioral/model retries; static, privacy and description checks never retry.

## Capabilities

### Modified Capabilities

- `distribution-boundaries`: accountable CI test recovery and frequency enforcement.

## Impact

CI test orchestration, Delivery summary, trusted issue tracking, contributor guidance and focused runner/policy tests. No application storage or runtime change.
