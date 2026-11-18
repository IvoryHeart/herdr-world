# Implementation summary — CI browser suite scaling

- **Parent spec:** [`014-ci-browser-suite-scaling-spec.md`](014-ci-browser-suite-scaling-spec.md)
- **Implemented at:** 2026-08-14
- **Implementation status:** Complete

> The approved contract is retained unchanged. This record describes the
> delivered implementation, validation evidence, and deferred boundaries.

## Delivered implementation

- **Implemented:** Commit [`d7b3eab`](../../commit/d7b3eab) removes the duplicate
  `feat/**` push trigger, adds pull-request concurrency cancellation, separates
  non-browser and browser jobs, and runs four concurrent GitHub Actions browser
  shards with `--fully-parallel --workers=1 --shard=N/4` and
  `strategy.fail-fast: false`.
- **Implemented:** CI Playwright execution now uses one retry,
  `on-first-retry` tracing, and `--fail-on-flaky-tests`. Failed diagnostics use
  shard- and workflow-attempt-specific artifact names.
- **Implemented:** The Office `New seat` test dynamically moves the open
  conversation until its rectangle no longer intersects the target button,
  validates actionability with a trial click, and performs a bounded ordinary
  click without `force`.

## Acceptance evidence

- `npm run check` passed locally: vendor validation, lint, 369 web tests, 114
  compatibility tests, 148 bridge tests, and both builds.
- The targeted `New seat` test passed 10 consecutive times under CI retry,
  tracing, and flaky-test settings in 2.1 minutes.
- Test-level shard inventory was 12 / 12 / 11 / 11, with no file-level
  concentration of `world.spec.ts`.
- All four local shards passed cleanly: shards 1 and 2 each had 11 passed and
  1 expected skip; shards 3 and 4 each had 11 passed.
- GitHub Actions run `31817383160`
  passed all five jobs on implementation commit `d7b3eabc32ecf2521bbcf6db1825a6f34019b7ad`.
  The non-browser job took 2m35s; browser shards took 1m03s, 3m57s, 3m28s,
  and 2m47s. No shard required a retry or was classified as flaky.

## Constraints and drift

- **Drift:** None from the approved contract.
- The fixture reset API remains global; isolation is provided by one fixture
  process per matrix runner, while each runner retains one Playwright worker.
- Pixi ticker suspension, state/layout-driven rendering, texture caching, and
  Rust target/cache reuse remain deferred as specified.
- Generated outputs and the pre-existing working-tree evidence images were not
  included in the implementation commit.
