# Space allocation foundation contract

## Intended behavior

Source requirement: [world surfaces](../../openspec/specs/world-surfaces/spec.md).
Owner: `web/src/world/spaceAdmission.ts`. Accepted source delivery: PR #145;
reviewed allocation evidence: PR #188 at `5d73319b`.

Allowed: relevant spaces reserve bounded capacity in stable input order; ordinary
spaces then use fair rounds across hosts. Forbidden: exceeding capacity, admitting
absent spaces, duplicates, starving an earlier same-host ordinary space, or taking
an additional host round before an available host receives its earlier round.

## Model and implementation mapping

`quint/space-admission.qnt` has input-position IDs (`present`),
classification (`relevant`), capacity (`bound`) and selected membership (`admitted`).
Its ordinal/rank specification is independent of the production bucket loop.
`replaySpaces` constructs synthetic production objects and invokes the real
allocator. Workspace focus supplies relevance. Membership is compared as a set;
the relevant prefix's order is also checked. Ordinary output order is unspecified.
Each allocation is an independent call, not a lifecycle transition.

## Properties, witnesses and negative controls

`safety` combines bounded/subset output, relevant-prefix admission, reference
membership equality, full use of available capacity, same-host prefix and host
round fairness. The latter three independently constrain reference agreement.
Actual replay counts `mixedPriority` and `allHosts`. Faulty-model and compiled
production controls choose an input prefix: counterexample replay must fail
`spaces.membership`; generated mutation replay must fail permitted membership or
priority observations. Unrelated failures cannot count as sensitivity evidence.

## Domain, environment and limitations

Six spaces on three unequal hosts (3/2/1), every absent/ordinary/relevant assignment,
capacities 0–6: exactly 5,103 configurations. TLC uses configuration initialization
and a self-loop; deterministic enumeration replays each configuration exactly once.
Seeds 42/73/103 add 100 traces each from 500 samples and up to 25 steps. All six
host block orders separately verify and replay all configurations. This finite
sensitivity does not cover arbitrary domain sizes,
leaf relevance classification, rendering or upstream observation authority.
No fairness over time or temporal progress is claimed.

## Evidence and promotion

Maintained verification requires complete enumeration, distinct configurations,
actual witnesses, dedicated negative controls and a complete manifest. Accepted within the documented bounds by [independent review 5516249164](https://github.com/IvoryHeart/herdr-world/pull/188#pullrequestreview-5516249164). Mandatory consumer tests and excluded claims remain unchanged; gate/resource delivery still requires final review.
