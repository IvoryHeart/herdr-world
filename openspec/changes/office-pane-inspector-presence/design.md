## Context

See [proposal.md](proposal.md) for the user outcome and [the Office mockup](office-presence-mockup.svg) for the proposed composition. The current Office projection maps desks to tabs, seats at most one room-local agent per tab, and places other working agents in a separate standing grid. Its reception renders four waiting agents per host. Inspector conversations are independent windows, but terminal file-link handling currently opens the shared resource state without selecting Files in the originating visual conversation. Visual window focus and exact pane focus cross several portal and terminal-presentation boundaries.

## Goals / Non-Goals

**Goals:** Preserve one terminal owner and exact connection, generation, tab and pane identity while routing file links and input. Extend the existing Office furniture and bounded projection so pane devices and mixed-status reception agents remain readable and actionable.

**Non-Goals:** Change Herdr's pane state, create a new runtime acknowledgement state, replace the existing Office art system, or introduce image assets or service methods.

## Decisions

- Route terminal file-link requests with their originating Inspector window identity as well as existing connection, generation, workspace and pane information. Update that conversation's resource tab to Files, open the file in its independent resource state and raise that window. Reuse the Spaces path for its single Inspector. A window-local handoff avoids changing another Inspector's selected tab when several windows share one workspace.
- Treat visual window activation and pane selection as separate but ordered events. Resolve the current qualified conversation and pane, focus the pane through the existing selected-connection path, then focus that window's mounted terminal input after the target is admitted. Guard asynchronous completion against window, pane, selected-host and generation changes; never use the merely focused Spaces pane as a fallback. Resource-tab controls retain normal keyboard focus when Terminal is not active.
- Keep desk identity tab-based. Draw a small laptop or monitor for each of up to three panes per presented desk, using the current Pixi palette and geometric drawing style. Group the corresponding working characters immediately beside or below that desk in stable pane order. Reserve this footprint in room geometry rather than overlaying adjacent desks. The existing desk monitor and desk semantic target remain tab-level; each added device receives a separate pane-level target. A `+N panes` cue and the existing chooser expose the rest. This is preferable to treating each pane as a new desk, which would misrepresent tabs and eight-desk room capacity.
- Keep pane devices keyed by qualified pane identity while the tab and pane are admitted. Agent movement changes only the character's destination. Dim an unoccupied device without disabling it; remove the device when the pane closes or the generation retires. The device opens the same exact pane as its associated agent, including when the agent is at reception or the bar.
- Reuse each host's existing reception table and four seats for both blocked and done agents. Add a bounded row of standing positions around it, with stable ordering and enough geometry to avoid collisions; keep the exact overflow count and roster beyond that bound. Draw high-contrast `?` and `✔` badges by characters with status words in accessible labels and tooltips. `blocked` is the available authoritative status for input needed; retain its exact runtime state label when one is present rather than asserting an unsupported cause. Completion paper and seen state remain independent of location. An agent moves to the bar only when Herdr reports `idle`.
- Keep the mockup illustrative. Implement its shapes in the existing Pixi renderer and semantic target layer, with the same 48 CSS-pixel minimum target size and compact chooser route used for current Office entities.

## Risks / Trade-offs

- **A visual click can race a pane switch or terminal remount** → fence the focus request to the exact current window and pane, and focus input only after its terminal owner is mounted.
- **More furniture can crowd dense rooms or reception** → bound per-desk devices and standing positions, reserve geometry for visible items, and expose every omission in the chooser and exact counts.
- **Symbols can be ambiguous or font-dependent** → draw the checkmark as a simple vector mark, keep explicit status text in accessible names, and verify the result at normal and compact scale.

## Migration Plan

No persisted data or service migration is required. Existing Inspector resource preferences and Office seen-completion state remain valid. Removing the browser change restores the prior presentation without changing Herdr state.
