## Context

See [proposal.md](proposal.md) for the user outcome and [the Office mockup](office-presence-mockup.svg) for the proposed composition. The current Office projection maps desks to tabs, seats at most one room-local agent per tab, and places other working agents in a separate standing grid. Its reception renders four waiting agents per host. Inspector conversations are independent windows, but terminal file-link handling currently opens the shared resource state without selecting Files in the originating visual conversation. Visual window focus and exact pane focus cross several portal and terminal-presentation boundaries.

## Goals / Non-Goals

**Goals:** Preserve one terminal owner and exact connection, generation, tab and pane identity while routing file links and input. Extend the existing Office furniture and bounded projection so pane devices and mixed-status reception agents remain readable and actionable.

**Non-Goals:** Change Herdr's pane state, create a new runtime acknowledgement state, replace the existing Office art system, or introduce image assets or service methods.

## Decisions

- Route terminal file-link requests with their originating Inspector window identity as well as existing connection, generation, workspace and pane information. Update that conversation's resource tab to Files, open the file in its independent resource state and raise that window. Reuse the Spaces path for its single Inspector. A window-local handoff avoids changing another Inspector's selected tab when several windows share one workspace.
- Treat visual window activation and pane selection as separate but ordered events. Resolve the current qualified conversation and pane, focus the pane through the existing selected-connection path, then focus that window's mounted terminal input after the target is admitted. Guard asynchronous completion against window, pane, selected-host and generation changes; never use the merely focused Spaces pane as a fallback. Resource-tab controls retain normal keyboard focus when Terminal is not active.
- Keep desk identity tab-based. Replace the desk's old black screen with a central laptop for the first pane and put the exact observed pane count on that laptop. Draw up to three additional pane screens with the old monitor shape, to the left, right and above the laptop; panes beyond four remain in the chooser. Group up to four additional working characters around the desk in stable pane order, with two behind and two beside the table, and move the side monitors inward to keep faces clear. Fit these devices and smaller companion characters inside the existing desk-cell width and row height. Keep distinct, nonoverlapping targets of at least 24 by 24 CSS pixels for this compact group, with keyboard names for each target. The tab label remains the desk's own target, while each device activates its exact pane. This preserves the prior Office density and eight-desk room capacity.
- Keep pane devices keyed by qualified pane identity while the tab and pane are admitted. Agent movement changes only the character's destination. Dim an unoccupied device without disabling it; remove the device when the pane closes or the generation retires. The device opens the same exact pane as its associated agent, including when the agent is at reception or the bar.
- Reuse each host's existing reception table and four seats for both blocked and done agents. Add a bounded row of smaller standing characters at the front of that table without increasing the station height; keep the exact overflow count and roster beyond that bound. Draw high-contrast `?` and `✔` badges by characters with status words in accessible labels and tooltips. `blocked` is the available authoritative status for input needed; retain its exact runtime state label when one is present rather than asserting an unsupported cause. Completion paper and seen state remain independent of location. An agent moves to the bar only when Herdr reports `idle`.
- Keep the mockup illustrative. Implement its shapes in the existing Pixi renderer and semantic target layer; the compact desk and reception groups use nonoverlapping targets of at least 24 CSS pixels, while other Office semantic targets retain the 48 CSS-pixel minimum and chooser route.

## Risks / Trade-offs

- **A visual click can race a pane switch or terminal remount** → fence the focus request to the exact current window and pane, and focus input only after its terminal owner is mounted.
- **More furniture can crowd dense rooms or reception** → scale the added art within existing desk and reception footprints, bound visible positions, and expose every omission in the chooser and exact counts.
- **Symbols can be ambiguous or font-dependent** → draw the checkmark as a simple vector mark, keep explicit status text in accessible names, and verify the result at normal and compact scale.

## Migration Plan

No persisted data or service migration is required. Existing Inspector resource preferences and Office seen-completion state remain valid. Removing the browser change restores the prior presentation without changing Herdr state.
