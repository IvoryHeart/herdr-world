## Context

Spaces remains mounted behind the visual views, and `App.tsx` disables operational shortcuts while it is hidden. Visual views already have guarded selection and a shared Inspector in `WorldFoundationApp.tsx`; `focusWorldNode` and the service route actions by selected connection and runtime generation. The former foundation explicitly deferred the Spaces-focused Actions palette on visual routes.

## Goals / Non-Goals

**Goals:** A common visible-target Actions seam, shared capability logic, keyboard access and safe reuse of existing Inspector/Spaces navigation.

**Non-Goals:** A generic agent command bus, raw terminal injection from the palette, new Herdr methods, duplicate room controls, cross-host operations or replacing the Spaces command palette.

## Decisions

### Capture an immutable visual action target

Build a small target value from the selected node: World ID, connection ID, runtime generation, workspace ID and optional pane/terminal IDs. A single action resolver maps that target to current WorldObject and focused-store state immediately before dispatch. An action does not consult Spaces' hidden selected pane. Selection, host or generation changes close or invalidate the menu; rejection leaves current Inspector conversations intact.

### Reuse the existing resource and view paths

Terminal/Files/Changes/History invoke the same `applySelection` or Inspector request path used by visual selection, with an explicit requested tab. Go to Spaces validates/focuses the captured target first, then switches the visible view using the existing shell navigation path. Avoid a second attachment or a direct `terminal.input` shortcut. Room operations stay where Office currently presents their named controls.

### Make the menu common to all three visual views

Place a named Actions control in the shared top bar and wire the visual-route command shortcut to this context while Spaces keeps its current command menu. The menu announces target host/space/agent and disabled reasons; pointer, keyboard and compact layouts use the same resolver. No selection shows an instruction to select a visual entity.

## Risks / Trade-offs

- [Focus and selected entity change during an async open] → Capture a request sequence and revalidate the same lease before reporting success or changing views.
- [Menu duplication with per-view context menus] → Reuse the resolver and capability map; per-view menus may call the same actions but may not implement another routing policy.
- [A future task-control action lacks a Herdr contract] → Do not add it here. Specify its capability, target, acknowledgement and failure semantics in a later reviewed change.

## Migration Plan

Spaces shortcuts and saved preferences remain valid. The visual entry point is additive and can be removed without changing Herdr or persisted data.
