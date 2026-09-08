## Context

The owner approved the common sidebar and Direction A, Operations Console. This is a continuation of that decision, not a new design interview. See proposal.md for scope. Tree already consumes the host-qualified graph projection and delegates actions to shared World guards.

## Goals / Non-Goals

The desktop composition uses a persistent common sidebar, compact central hierarchy and a narrower inspector. Tree must remain useful on a phone through its semantic hierarchy. This change does not add new runtime entities, telemetry, tabs as hierarchy levels, or independent terminal ownership.

## Decisions

### Adopt the existing sidebar implementation

Integrate the actual PR #79 branch and reconcile its shell changes with the Tree parent. Its View picker becomes the single navigation control for Spaces, Office, Tree and Graph. Keep its Hosts menu, connection attention summary, Add Host settings flow, scope/list filters and mobile focus restoration. Styling a second Tree-only sidebar would duplicate navigation and is excluded by the owner's adoption decision.

### Compact Operations Console

Use the reference's dark dashboard composition: a quiet top toolbar, restrained panel borders, compact type-labeled cards, visible status badges, orthogonal connectors and aligned host/space/agent-or-terminal tiers. The central hierarchy is the main reading surface. Keep operational context visible in an inspector: selection identity, ancestry, current state and guarded actions, with an unselected overview based only on observed data. A small summary strip and type legend may expose existing projected counts and cues; do not invent throughput, cost, progress or service health.

Keep the shared sidebar usable beside the Tree and avoid consuming a second sidebar's width with a full duplicate roster. Preserve a keyboard-accessible semantic hierarchy, presented compactly within the inspector and as the primary phone surface. Use existing icons and CSS, with no raster artwork or production dependencies.

### Preserve interaction and data ownership

Retain search with ancestors, independent host/space collapse, shared selection without activation, exact-generation action guards, pan/zoom/Fit, validated Tree-only preferences and canonical history. Strengthen connectors using actual branch geometry so unequal subtrees stay attached; collapsed and empty branches must not leave dangling child connectors. The hierarchy remains host → space → agent/terminal.

## Risks / Trade-offs

- Sidebar merge conflicts can drop newer World behavior → reconcile against both parents and exercise all four views, live terminal persistence and mobile focus.
- Compact cards can hide useful state → separate kind/status from bounded secondary metadata; keep full operational detail in the inspector and accessible names.
- Wide host branches can exceed the viewport → keep bounded camera controls and verify dense/unequal branches; do not shrink text until unreadable.
- Phone width cannot support three columns → use the existing compact semantic interaction with scrolling, clear details and named actions.

## Validation and delivery

Use test-first development for navigation/behavior changes and rendered browser inspection for visual styling. Compare desktop, dense/unequal branches and phone against the retained original reference. Use synthetic fixtures for all published captures. Obtain task-scoped independent review and a final branch review, resolve findings, run `npm run check:acceptance` and strict OpenSpec validation, then open a ready PR stacked on PR #81. Preserve the worktree and private evaluation facts; stop before merge.
