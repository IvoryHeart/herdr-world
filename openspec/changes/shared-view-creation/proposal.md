## Why

Office creation is intermittent because the clicked room, prepared terminal and
dispatched creation source can differ. Users can create reliably in Spaces but
must leave their visual view to do so; issue [113](https://github.com/IvoryHeart/herdr-world/issues/113)
reports this on mobile, and synthetic diagnostics reproduce a second-room failure
on desktop and at a 390 px mobile viewport.

## What Changes

- Make Office the root and fallback view while retaining every explicit view route.
- Give Office, Desk, Tree and Graph shared New workspace and New tab actions that
  retain the current view and open the created terminal in its qualified Inspector.
- Route Office room/desk controls, shared tab creation, Inspector shortcuts and
  Spaces creation through the same qualified preparation and creation operations.
- Prepare the intended source on demand without requiring Spaces or an existing
  Inspector, and distinguish connection/capability availability from this browser's
  live attachment readiness.
- Load an unobserved host's operational session before choosing its navigation mode,
  source or empty-host bootstrap path.
- Preserve exclusive terminal ownership through attachment, detachment, presentation
  handoff, reconnects and creation; never replay an uncertain mutation.
- Treat Office's eight rendered desks as a presentation bound, so reaching that
  bound does not block creation in the underlying workspace.
- Give all successful creation entry points the same bounded admission and focus
  handling, preserving the previous Inspector on failure.

## Capabilities

### New Capabilities

None. This extends the existing World surfaces contract.

### Modified Capabilities

- `world-surfaces`: Office default navigation, shared creation across every view,
  exact destination preparation, mobile controls, exclusive attachment ownership
  and post-creation terminal presentation.

## Impact

Browser shell, creation dialogs/menus, per-connection store operations, terminal
ownership/readiness, Office canvas and semantic controls, and focused browser and
service regressions. The existing qualified service RPCs, browser-local endpoint
creation validation and empty-host bootstrap remain the operational boundary.
Service changes are justified only where current attachment lifecycle evidence
requires them; this proposal does not add a runtime or change Herdr's API.

Spaces retains its Roamgate-derived layouts, mobile keyboard behavior and terminal
protocol. No dependency, distribution, agent-launching or room-layout redesign is
included. Starting a workspace/tab means creating it and opening its terminal;
automatic shell commands or agent assignment are outside this change.

The owner has authorized analysis and specification only in this phase.
Implementation will start after the owner resumes it. See [design.md](design.md)
for reproduced evidence, constraints and the selected approach.
