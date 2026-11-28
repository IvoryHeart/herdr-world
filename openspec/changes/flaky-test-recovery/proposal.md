## Why

Whole-step retries repeat passing tests and conceal recurring failures. Issue #1421 authorized scoped test recovery. The owner's revised #1454 mandate removes per-run accounting workflows and all flake frequency gating to prioritize time from green to merged.

Issue #1484 combines the proven #1472 graph/browser fixes with #1478's wait
removals, phase timing and model packing, retaining memory bounds and every check.

## What Changes

- Keep one in-job retry of failed unit files or exact browser cases; persistent failures remain red.
- Report all attempted retries in existing job summaries and small flaky.json artifacts, without blocking delivery.
- Replace per-run workflow_run tracking, receipt caches, commit statuses and frequency enforcement with one daily schedule plus manual dispatch.
- Update one Flaky tests issue with retry counts and latest run links from the last 24 hours of same-repository CI runs.

## Capabilities

### Modified Capabilities

- `distribution-boundaries`: scoped retry and informational daily accounting.

## Impact

CI workflows, retry evidence, daily trusted issue reporting, contributor guidance and verification consumer mapping. No application storage or runtime changes.

Issue #1487 additionally authorizes root-cause repairs: deterministic process/time
ports, sealed test discovery, matching local/CI Chrome and a separate repeated
quiet performance lane. Existing tests, assertions and budgets remain binding.
