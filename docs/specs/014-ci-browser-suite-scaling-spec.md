# CI Browser Suite Scaling

- **Spec ID:** `014-ci-browser-suite-scaling`
- **Status:** Approved
- **Created:** 2026-08-14
- **Owner:** Herdr Web CI maintainers
- **Reviewers:** Repository requester
- **Approved by:** Repository requester
- **Approved at:** 2026-08-14

> This document may be edited only while its status is `Draft` or `In review`.
> After approval it is immutable. After implementation completes, record
> delivery and drift in `014-ci-browser-suite-scaling-spec-summary.md`; put
> later intended changes in a numbered extension document.

## 1. Purpose

The Office and World browser suite has outgrown a single serial CI worker.
Failures currently amplify through long test timeouts and two retries, while
pull-request pushes can launch duplicate workflows. This spec bounds the CI
changes needed to preserve browser coverage while making feedback faster,
diagnosable, and resistant to superseded-run waste.

## 2. Scope

This change covers:

- making pull requests and `main` pushes the canonical CI triggers;
- cancelling superseded pull-request runs;
- separating non-browser checks from browser checks;
- running the complete Playwright suite as four isolated one-worker,
  test-level shards;
- using one CI retry, tracing only on the first retry, and failing when a test
  is classified as flaky after a retry;
- making the existing `New seat` browser assertion wait for verified
  actionability with a bounded click timeout; and
- retaining per-shard Playwright diagnostics.

## 3. Non-goals

This change does not:

- change Herdr or Herdr Web protocol compatibility;
- change the browser fixture API or product runtime behaviour;
- make the Pixi renderer use a different rendering policy, pause its ticker, or
  cache textures across Office mounts;
- increase Playwright workers within a fixture process; or
- add Rust compilation caching. These may be proposed separately after the
  sharded workflow is measured.

## 4. Context and constraints

- `.github/workflows/ci.yml` currently runs all checks and browser tests in one
  job with one Playwright worker.
- `tests/e2e/world.spec.ts` resets the shared fixture through
  `POST /__fixture/reset`; concurrent workers in one fixture process would
  interfere with one another.
- A GitHub Actions matrix job provides process and fixture isolation because
  each matrix entry runs on its own runner.
- The repository uses Playwright 1.55 and supports `--fail-on-flaky-tests`,
  `--fully-parallel`, and `--shard`.
- CI must retain read-only repository permissions and must not expose fixture
  state or browser artifacts outside the existing workflow artifact scope.

## 5. Requirements

### Requirement: Use canonical CI triggers

The CI workflow SHALL run for pull requests and pushes to `main`, and MUST NOT
run an additional push-triggered copy for `feat/**` branches.

#### Scenario: Pull-request updates

- **GIVEN** a pull request branch receives a new commit
- **WHEN** GitHub evaluates workflow triggers
- **THEN** one pull-request CI workflow is eligible for that commit, without a
  second `feat/**` push workflow

### Requirement: Cancel superseded pull-request work

The CI workflow SHALL group runs by workflow and pull-request identity, and
SHALL cancel an in-progress pull-request run when a newer commit supersedes it.
Pushes to `main` MUST NOT be cancelled merely because another `main` push is
queued.

#### Scenario: New pull-request commit arrives

- **GIVEN** a pull-request CI run is in progress
- **WHEN** a newer commit is pushed to that pull request
- **THEN** the older run is cancelled and only the newer run remains the
  authoritative candidate check

### Requirement: Separate non-browser and browser gates

The workflow SHALL expose non-browser checks and browser checks as separate
jobs that are eligible to run concurrently. The browser matrix MUST NOT declare
the non-browser job as a `needs` dependency. The non-browser job SHALL continue
to run the existing vendor, lint, web, compatibility, bridge, build,
independence, and security checks. Browser jobs SHALL install only the
dependencies needed to build and exercise the web application and Playwright
fixture.

#### Scenario: Browser failure

- **GIVEN** all non-browser checks pass
- **WHEN** a browser shard fails
- **THEN** the browser gate fails independently and its shard diagnostics are
  available without hiding the non-browser result

### Requirement: Run isolated browser shards

The workflow SHALL run the complete Playwright test set in four matrix shards.
The browser invocation SHALL explicitly use test-level sharding with
`--fully-parallel --workers=1 --shard=N/4`. Each shard SHALL use one Playwright
worker and its own fixture server process. The matrix strategy SHALL set
`fail-fast: false`. The matrix SHALL not omit, duplicate, or conditionally
disable browser tests other than tests already explicitly skipped by the
repository.

#### Scenario: Shared-reset fixture coverage

- **GIVEN** two browser shards run concurrently
- **WHEN** both execute tests that call `POST /__fixture/reset`
- **THEN** each shard resets only its own runner-local fixture process and no
  test can reset another shard's state

### Requirement: Bound retry and trace amplification

CI browser execution SHALL use at most one Playwright retry, SHALL use
`on-first-retry` tracing, and SHALL invoke Playwright's flaky-test failure mode
so a test that passes only after a retry does not produce a green browser gate.
Local development execution MAY retain zero retries and local diagnostic
preferences.

#### Scenario: Test passes only after retry

- **GIVEN** a browser test fails on its first attempt and passes on its one
  retry
- **WHEN** the shard completes
- **THEN** Playwright classifies the test as flaky and the browser job fails
  while retaining the first-retry trace

### Requirement: Make the New Seat assertion actionable

The Office callout test SHALL dynamically reposition the open conversation
window until its rectangle and the selected `New seat` button rectangle do not
intersect. It SHALL then perform an actionability trial-click check, followed by
a real click bounded to five seconds or less. The real click SHALL not use a
forced click, and the test SHALL preserve the assertion that the launch modal
opens.

#### Scenario: Conversation overlay is still covering the control

- **GIVEN** the `New seat` button is visible but an open conversation window
  intercepts its pointer location
- **WHEN** the test attempts the action
- **THEN** it repositions the conversation until the rectangles no longer
  intersect, verifies actionability with a trial click, and either performs the
  bounded real click or fails with diagnostic evidence instead of waiting
  through the 90-second test timeout and retries

### Requirement: Preserve shard diagnostics

Each browser shard SHALL upload its Playwright output on failure using a
shard- and workflow-attempt-specific artifact name, such as
`playwright-diagnostics-2-attempt-1`. Diagnostics MUST remain scoped to the
failed workflow run and MUST NOT include credentials or production data.

#### Scenario: One shard fails

- **GIVEN** shard 3 fails while the other shards pass
- **WHEN** the workflow uploads artifacts
- **THEN** shard 3's diagnostic output is available under a unique artifact
  name and the other shards' output remains independently attributable

## 6. Data and interface contract

No application or protocol data contract changes. The workflow may add CI-only
environment values for shard selection and Playwright options. The fixture
server remains local to each runner and its reset endpoint remains unchanged.

## 7. Privacy and security

The workflow SHALL retain `contents: read` permissions, use the existing
dependency installation and security checks, and upload only CI diagnostics
generated by the browser tests. Fixture snapshots, logs, and artifacts are
synthetic test data; no production endpoint or credential may be introduced.

## 8. Acceptance evidence

Acceptance requires:

- configuration checks showing the trigger, concurrency, retry, tracing, and
  four-shard settings;
- the targeted `New seat` test passing at least ten consecutive repetitions
  with non-intersecting rectangles, a successful trial click, and an ordinary
  (non-forced) real click;
- all four local test-level shard commands completing with the same test
  inventory as an unsharded run;
- `npm run check` passing;
- a GitHub Actions run with all non-browser and browser shard jobs passing,
  with no shard classified as flaky; and
- recorded per-job durations to compare the new feedback path with the
  previous serial workflow. The estimated three-to-five-minute feedback time
  is an optimization target, not a compatibility contract.

## 9. Deferred decisions

- Pixi ticker suspension, state/layout-driven rendering, and texture caching
  require a separate product-performance specification.
- Rust target/cache reuse requires a separate measurement and cache-integrity
  decision.
- Parallel workers inside one fixture process remain deferred because the
  current global reset API is not worker-scoped.
