## Why

World has numeric harness usage but no shared effort, project or daily analytics
read for the Usage surface requested in #1014. #1029 needs a stable data API.

## What Changes

- Add bounded seven-day analytics over existing harness, runtime status, checkout
  and work-source evidence, with explicit unknowns and observed coverage.
- Support the same read through authenticated World RPC and the local agent CLI.
- Extend numeric collection to core host runtimes, retaining generation fences.
- Document the consumer contract, refusals and testing fixtures. No UI changes.

## Capabilities

### Modified Capabilities

- `world-usage`: view-neutral analytics by agent, project, room and UTC day.

## Impact

Usage service, core host adapter, World verb admission, agent CLI, GitHub numeric
timestamps, current usage documentation and focused service/API tests. Existing
usage responses remain compatible. No provider API, pricing inference or UI.
