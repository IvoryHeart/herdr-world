# Staged aggregate observation contract

## Intended behavior

Requirement: [runtime federation](../../openspec/specs/runtime-federation/spec.md).
Owner: `web/src/world/runtimeStore.ts`; source delivery PR #145. This expands
observation evidence beyond the independently accepted atomic refresh foundation.

Allowed: decoding and projection yield to input/lifecycle tasks; retiring one
captured owner makes only that owner stale/non-actionable; healthy siblings can
publish; current request failure retains unavailable topology. Forbidden: an
observation from an old epoch publishing after disconnect, an admitted connection
using another owner's identity or generation, or a retired captured owner retaining
action authority through cooperative preparation.

## Model and implementation mapping

`browser-preparation.qnt` models two captured generation-1 owners and independent
browser observation authority. `stage` separates pending reply, decoding, World
object construction and final office preparation/admission. `captured` is the
request epoch; `live` is client-qualified owner currency; `actionable` is published
action authority. `issued`, `revision`, `published` and `catalogue` identify request
and publication history. `selected`, `requested` and `queued` distinguish current
scheduling intent from the hint captured by an outstanding request. Owner retirement does not itself erase cached topology;
consumers must still validate their own qualified leases.

`browser-preparation.ts` drives the real store using controlled reply promises and
its preparation scheduler dependency. The default dependency is the existing
`yieldWorldTask`; injected schedulers change when existing yields resume, not the
parsing, projection or revalidation algorithms. Office preparation also accepts
that same scheduler. A red/green production regression establishes the concrete
need: the test must interrupt decoding without timer races and prevent admission.

`reply` resolves a real two-owner, non-null, empty-but-valid snapshot and pauses at
the first decode yield. `project` releases it and pauses during actual object
construction. `prepareOffice` releases construction and pauses at office's final
yield, immediately before owner revalidation/publication. Repeated yields within
one stage continue; the first yield is independently driven. `admit` resumes and
awaits the owning refresh task. Disconnect uses the real status callback; retirement
updates the real Bridge runtime catalogue from captured generation 1 to ready
generation 3. The real qualified client rejects generation 1 while preserving
the healthy peer; a new ready incarnation cannot restore old authority. Failure rejects the real pending request. `priority` changes the selected-host
hint during preparation; completion admits current work and dispatches exactly
one queued follow-up with the latest hint. A recording public refresh entry point
retains each real task, including automatically dispatched follow-ups.
Qualification calls record their actual owner IDs and explicit generation; a
separate generation-omission mutation must fail
`preparation.qualification.generation`, even when the legacy client would be
rejected too. All steps check status, revision, call count, catalogue size, IDs, generation,
actionability and stale state. Cleanup releases pending stages and drains refresh.

## Properties, witnesses and negative controls

`safety` requires ready publication to have the current observation epoch and
admitted actionability to match captured-owner currency. Actual replay measures
decode, object and admission interruption, sibling survival, request failure and changed-priority follow-up.
Deterministic tests additionally retire and disconnect at each of the three stages
and complete the remaining preparation: six direct boundary regressions.

The model fault allows obsolete admission and must fail `preparation.status` or
another permitted publication observation. A compiled epoch-guard fault must also
fail a named preparation observation. A separate compiled owner-revalidation fault
must fail `preparation.actionable`; a substituted selected-host hint must fail
`preparation.hint`; it cannot borrow an epoch failure as evidence.
Parser, invalid-action, scheduler, adapter and drain errors fail the run.

## Domain, environment and limitations

Two hosts with colliding empty native resource domains, generation 1, epochs 0–3,
at most three requests, successful replies or request rejection, seeds 42/73/103,
500 samples and 500 replay traces per seed, up to 25 transitions. TLC verifies
finite safety. Retirement is monotonic within this abstraction. The injected
scheduler gates actual yields; it does not prove real browser scheduling or progress.
Normal/browser tests retain timer, dense projection and responsiveness evidence.

Queued refresh and selected-host changes are now composed with staged replay.
Resource-priority normalization, hint bounds and applied-version waits retain real
integration tests. Priority hints affect scheduling, not captured runtime authority.
New-generation snapshot admission, nonempty resource assembly and composition between
resource-priority version waits and staged authority remain scoped integration
evidence. Larger epoch/request bounds and actual replay witnesses for each seed are implemented
in task 3.3; they remain finite sensitivity evidence. No temporal liveness claim.

## Evidence and promotion

Run maintained verification and typecheck commands; normal Bun tests execute the
ten cheap staged replay regressions and real scheduler store tests. The runner records exact per-model/per-seed replay counts and sensitivity
settings; preparation replays every sampled path to retain rare witnesses. Manifests identify exact staged inputs, tools and results.
Review 5516249164 independently accepts the bounded observation mapping and Q14 staged/queued evidence. Its mandatory scheduler/store/browser consumers and excluded claims remain required. The unfiltered gate is implemented in local and protected CI delivery; final acceptance of gate/resource repairs remains outstanding.
