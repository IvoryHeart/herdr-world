# Window command ordering: exhaustive implementation alternative

Requirement: `openspec/specs/world-surfaces/spec.md`; owner:
`web/src/world/windows/windowManager.ts`. Admission, explicit reveal/hide,
arrangement restore and removal must preserve each window's identity and intent.

`windowOrdering.test.ts` explores the real pure reducer/reconciliation functions.
Its 21 commands include two owners' focus/raise/minimize/dismiss/maximize,
four arrangements, Open all, restore, dismiss-all and all four catalogue subsets.
Breadth-first exploration checks every outgoing command from states reachable
within four steps, so all histories of up to five commands are represented.
Equivalent states are deduplicated after excluding the monotonic reveal counter;
that counter is checked on every transition and does not select reducer branches.
The rest of the real state, including geometry, stack, baseline and flags, stays
in the fingerprint. This is bounded exhaustive evidence, not unbounded proof.

The oracle checks exact catalogue/stack membership and uniqueness, hidden-owner
visibility, explicit focus ownership, peer hide isolation, preservation of normal
placement by focus/hide/maximize and restore's exclusion of removed, dismissed
or nonparticipating owners. A deliberately wrong transition hiding another owner
must fail the named peer-dismissal assertion. The oracle describes intended
observable properties rather than implementing a second copy of the reducer.

Direct exhaustive execution avoids an additional adapter and abstraction for a
synchronous pure transition system. This is the proposed reviewed alternative
for Q21, not a general exemption for asynchronous ownership or authority.
`windowManager.test.ts` retains targeted three-owner, viewport/divider, compact
projection and later-admission regressions. `WindowFrame.test.ts` retains actual
browser pointer/keyboard behavior. Floating-point geometry extremes, arbitrary
owner counts and all DOM event schedules are outside this finite domain.

Run `bun run test web/src/world/windows/windowOrdering.test.ts` and the existing
window/browser suites through `bun run check`. The alternative, finite domain and
consumer assumptions await independent adoption review.
