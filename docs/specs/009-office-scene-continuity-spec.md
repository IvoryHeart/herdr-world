# Office scene continuity

- **Spec ID:** `009-office-scene-continuity`
- **Status:** Approved
- **Created:** 2026-08-12
- **Owner:** Herdr Web / Office
- **Reviewers:** —
- **Approved by:** Requester
- **Approved at:** 2026-08-12

> This contract records a focused visual refinement to the existing responsive
> Office composition. It does not change Herdr state, room packing, or the
> mobile-specific layout decision.

## 1. Purpose

Make the boundaries and social spaces of the Pixel Office read as one
continuous scene while keeping the existing responsive geometry intact.

## 2. Scope

- Pixel-road separators in the configured gaps between Office rooms.
- A small inward offset for reception tables so their artwork remains inside
  the CEO Office boundary.
- A rear row of bar drinks and one foreground glass for each Agent Bar agent
  currently rendered.

## 3. Non-goals

- No change to room width, row packing, alignment, minimum width, or responsive
  breakpoints.
- No new Herdr or bridge state, persistence, command, or protocol field.
- No mobile-specific Office composition or art scaling.
- No glass for agents omitted by the bounded Agent Bar presentation.

## 4. Context and constraints

The renderer already owns the room-gap geometry, reception-table helper, and
qualified `barAgents` projection. Roads MUST remain behind room content, and
bar glasses MUST be derived from the same bounded agent list and slot positions
used to render the visible Agent Bar agents.

## 5. Requirements

### Requirement: Connect room blocks with roads

The Office SHALL render pixel-road separators in the horizontal and vertical
gaps between visible room blocks without changing room rectangles.

#### Scenario: Rooms occupy more than one row

- **GIVEN** room packing produces adjacent rooms or multiple rows
- **WHEN** the Office scene is rendered
- **THEN** the existing gaps contain road-style separators behind the rooms,
  while room positions and dimensions remain unchanged.

### Requirement: Keep reception tables inside the CEO Office

Reception table artwork SHALL be nudged inward by a small fixed amount while
remaining within its host reception station.

#### Scenario: A reception station is at the CEO boundary

- **GIVEN** a reception station is rendered near the CEO Office edge
- **WHEN** its table is laid out
- **THEN** the table is shifted inward and does not visually cross the CEO
  Office boundary.

### Requirement: Associate bar glasses with visible agents

The Agent Bar SHALL render one foreground glass for each visible Agent Bar
agent, using that agent's slot, and SHALL retain a separate rear row of drinks
as bar decor.

#### Scenario: Agent Bar occupancy changes

- **GIVEN** the admitted projection contains a bounded set of visible bar
  agents
- **WHEN** the Agent Bar is rendered
- **THEN** each rendered agent has one aligned foreground glass, omitted agents
  do not create glasses, and the rear drink row remains present.

## 6. Data and interface contract

All changes are renderer-local. Room geometry continues to come from
`resolveOfficeLayout`; bar glass positions come from `agentBarSlot`; and no
browser-local or bridge state is added.

## 7. Privacy and security

No new data is collected, persisted, transmitted, or exposed. Decorative
graphics do not contain agent content or credentials.

## 8. Acceptance evidence

- Geometry tests cover the inward reception-table offset without changing room
  placement.
- Frontend lint, the full Vitest suite, and the production build pass.
- Manual responsive checks confirm that room roads remain behind the room rows
  and that Agent Bar glasses follow visible agent occupancy.

## 9. Deferred decisions

- Mobile-specific art composition and scaling.
- Rich bar inventory or agent-specific drink types.
