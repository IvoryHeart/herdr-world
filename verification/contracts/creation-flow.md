# Qualified source preparation, creation and conditional focus

## Intended behavior

Requirement: [World creation](../../openspec/specs/world-surfaces/spec.md), especially
qualified preparation/readiness and current-view creation. Source delivery PR #175.
Owners: `web/src/store.ts`, `creationRequests.ts`, `createdTerminalAdmission.ts`
and `useWorldCreatedTerminal.ts`.

Allowed: equivalent requests coalesce within the captured host/runtime/kind/source;
independent hosts may have identical native IDs; browser-owned attachment is
prepared and retained before a qualified mutation; a valid result waits for
matching topology before conditional focus. Forbidden: method advertisement alone
admitting dispatch, stale attachment acknowledgement replacing current ownership,
other-host coalescing, retirement during readiness permitting mutation, automatic
retry of uncertain dispatch and older creation overriding newer Inspector intent.

## Model and implementation mapping

`creation-flow.qnt` has two ready captured generation-1 destinations, each with
identical workspace/tab/pane/terminal IDs. `attempt` tracks browser attachment
incarnations; `retained` tracks source demand; `mutated` tracks dispatched work;
`intent` captures UI intent separately from runtime authority. Admission states
separate topology wait, asynchronous opening, completion and rejection.

`creation-fixture.ts` uses the real store singleton, its existing test seam and
real Bridge over synthetic same-origin transport. Sessions supply already validated
browser-local topology; they do not claim to prove initial runtime startup or
navigation discovery. `creation-subjects.ts` is a coherent bundle boundary so code
faults retain the shared store/Bridge/coordinator/error-class identities.

`start` invokes real `createQualifiedTab` and waits for public source demand.
`duplicate` checks actual promise coalescing; independent starts require distinct
promises. `beginAttach`/`oldAck`/`attach` drive real ownership methods and advertisements.
Successful attachment waits for actual qualified RPC dispatch. `retireAtReady`
uses a synchronous store observer to retire generation during readiness publication,
before mutation; this avoids a guessed microtask count. Retirement installs ready
generation 3. Real Bridge fencing rejects dispatched generation-1 calls as uncertain;
late replies cannot restore their result. The adapter checks retained sources,
progress, mutation count, generation, exact browser source tuple and `focus: false`.

A valid created identity enters real `admitCreatedTerminal`. Its environment reports
actual Bridge owner currency and a separately controlled intent/observation token.
Topology releases opening; the controlled opener obeys its real AbortSignal.
New intent and runtime retirement reject/abort admission and prevent later focus.
The generic admission model does not prove that a React caller supplies correct
inputs or that every opener honors cancellation. `SharedViewCreation.browser.tsx`
executes the actual hook: held creation after explicit Inspector close must not
reopen it, and view changes retain presentation. Existing terminal-handoff browser
tests check the real opener. These consumer assumptions remain reviewable evidence.

## Properties, witnesses and negative controls

`safety` requires source retention exactly through preparation/dispatch, current
runtime and captured intent through admission/opening, and zero mutation when
readiness publication retires the owner. Every seed replays all 500 sampled paths
and must witness preparation, old acknowledgement suppression, duplicate coalescing,
readiness retirement, uncertain dispatch, successful conditional focus and newer
intent rejection. Direct regressions cover colliding owners and retirement at
preparation/readiness/dispatch/admission/opening, plus new intent before result
and during opening.

The model fault treats old intent as admissible; production counterexample replay
must fail `creation.admission`. A compiled owner-key fault must fail
`creation.coalescing.owner`. A separate admission-fence fault must fail
`creation.admission` without waiting for its deadline. Cleanup aborts admission,
retires both captured owners, releases opening gates, drains callers and restores
store/transport state; retained sources and subscriptions must be empty.

## Domain, environment and limitations

Two hosts, one creation per host, two attachment attempts, captured generation 1
versus ready replacement generation 3, intent versions 0–2, one qualified tab kind.
TLC verifies finite safety; three seeds sample 500 paths of up to 25 transitions.
Workspace creation, shared navigation, validated empty bootstrap, unavailable
navigation, endpoint capability failures, real preparation/admission deadlines and
browser presentation retain existing store/browser regressions. The same coordinator
and preparation contract serves them, but this model does not relabel those branches
as enumerated. No arbitrary-size or temporal progress guarantee is claimed.

## Evidence and promotion

Run canonical verification/typecheck and normal Bun tests. Existing shared-view
browser suites remain required project checks. Q06/Q17/Q23 connect these models to
terminal ownership, creation and Inspector intent with their additional platform
boundaries. Accepted within the documented bounds by [independent review 5516249164](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5516249164). Mandatory consumer tests and excluded claims remain unchanged. Final implementation/gate/resource acceptance is recorded in [review 5517420140](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5517420140); owner-approved PR #188 merged as `481ca1e8`. Mandatory consumers and excluded claims remain binding.
