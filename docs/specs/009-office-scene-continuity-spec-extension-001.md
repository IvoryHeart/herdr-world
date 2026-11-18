# Office scene continuity — lower bottle row

- **Parent spec:** [`009-office-scene-continuity-spec.md`](009-office-scene-continuity-spec.md)
- **Extension:** `001`
- **Status:** Approved
- **Created:** 2026-08-12
- **Owner:** Herdr Web / Office
- **Reviewers:** —
- **Approved by:** Requester
- **Approved at:** 2026-08-12

## Purpose

Clarify the Agent Bar composition after live review: the bottle row belongs in
the lower part of the bar room rather than above the counter.

## Compatible change

The existing rear drink-row requirement is refined so the bottle row SHALL be
rendered at the bottom of the room, below the raised counter, inside the Agent Bar room. The counter and
its per-agent glasses move upward together, and visible agents move upward with
the counter. Party-board placement, occupancy, capacity, and responsive sizing
are unchanged.

## Acceptance scenario

- **GIVEN** the Agent Bar has one or more visible agents
- **WHEN** the bar is rendered
- **THEN** agents and their glasses sit above the counter, while the bottle row
  occupies the lower room band without clipping or changing the visible-agent
  capacity.

## Constraints

No Herdr state, bridge protocol, persistence, or agent projection changes are
introduced.
