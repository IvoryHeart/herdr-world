## Context

See [proposal.md](proposal.md) for the user outcome and the [World surfaces contract](../../specs/world-surfaces/spec.md) for current ownership. The shared shell mounts Spaces continuously and suspends its visible terminal presentation when a visual view owns that terminal. `WorldFoundationApp` retains up to one docked plus five floating Inspector conversations. A Tree docked Inspector can be portalled into its leaf. Floating geometry is saved per connection and World node. The tab bar is common to every view.

Today `App` renders the active Herdr tab's full `pane.layout` in Spaces, while `WorldTerminalPortalList` mounts one `TerminalView` for an Inspector's selected pane. The focused store fetches only the active tab's layout. Conversation identity is a World pane node, so sibling panes can currently create separate Inspectors. Roamgate's current tab bar and application expose pane splitting and resizing, without window arrangement controls. Herdr remains authoritative for pane topology and geometry; this change owns only browser presentation.

## Goals / Non-Goals

**Goals:**

- Give all visual views one predictable, reversible arrangement command over the Inspector windows already open, including the docked or inline Inspector.
- Make a Herdr tab the unit of terminal presentation in an Inspector while keeping selected-pane identity for the Inspector's other resources.
- Keep qualified terminal attachments singular and ensure window moves, view handoffs and splits refit to their real containers.

**Non-Goals:**

- Creating windows from background Herdr tabs, changing Herdr's split tree, opening more than the existing Inspector limit, or introducing server layout state.
- Turning the single Spaces terminal surface into a multiwindow workspace or exposing desktop arrangements on compact layouts.
- Adding a new dependency, WebSocket, SSH connection or terminal renderer.

## Decisions

### Separate Inspector window identity from selected pane

Use a qualified terminal-window key of connection ID, runtime generation, workspace ID and Herdr tab ID. Keep the currently selected pane and its World node as changeable conversation context. A space Inspector keeps its qualified space key. Selecting a sibling pane finds the tab window, focuses it in its existing presentation, and changes selected pane and applicable resource tabs. This preserves one window per tab and prevents two windows from presenting the same terminal pane. Its connector and compact identity follow the selected pane's World node. When that pane closes, choose a remaining pane in the same observed tab; retire the window when the tab or lease disappears. A pane that moves to another tab is re-resolved against current ancestry, never silently rebound by a reused native ID.

Pane-specific Files, Changes and History requests retain their captured pane and session identity. A sibling selection invalidates replies and selections that no longer match that identity, so one tab window never displays a previous sibling's late resource result under the new pane's header.

The alternative of keeping one window per pane would allow two sibling Inspectors to attach the same split tab and require hiding panes in one or both windows. The chosen tab key matches the user's requested split presentation and terminal ownership invariant.

### Render tab layouts through one reusable terminal presenter

Extract the Spaces pane-layout rendering behavior into a tab-scoped presenter that accepts a validated `PaneLayout`, current panes, selected pane and destination. Spaces supplies its active layout; each visible Inspector Terminal supplies the layout for its own tab. Fetch background tab layouts through the existing read-only `pane.layout` call using a pane in that tab. Revalidate connection, generation, workspace, tab and pane membership against the focused store before publishing a result. Refresh an open tab after split, close, move, zoom or resize events; cached geometry may bridge a same-membership refresh but must never make stale topology actionable. Limit requests to open terminal-capable Inspector tabs and reuse the existing connection lease.

Keep one portal owner per qualified terminal pane across Spaces and Inspector destinations. A tab window may contain several owners, but a pane has exactly one current destination; handoff detaches from the previous destination before attachment to the next. Refitting happens after geometry or destination changes. Pane focus and input remain routed through the existing qualified store and terminal gate. A shared tab presenter is needed because the store's single active `layout` cannot represent multiple open tab windows at once.

### Use one shell-level arrangement command and pure geometry resolver

Pass the current view and an arrangement callback from `WorldFoundationApp` through `App` to the shared `TabBar`. The control is one icon with a labelled menu and small layout previews. The callback snapshots eligible visible Inspector instances and their qualified lease; it makes no Herdr call. Spaces exposes the same control as unavailable while only its one native surface is visible. Invisible retained World Inspectors are never arranged while Spaces is active.

Resolve each preset from the actual visual-stage rectangle, current window count, focus order and minimum usable Inspector dimensions. Use one pure resolver for Cascade, Columns, Rows and Grid. Disable a preset atomically if it cannot satisfy its nonoverlap or reachability rules. Grid uses two columns for two windows, one full-height column plus two stacked for three, and four corners for four or more. For five or six, the most recently focused one or two keep floating geometry above the four tiles. Cascade offsets windows in z-order and exposes each older title. Use browser viewport coordinates only at the DOM boundary; the resolver takes rectangles in one coordinate system.

The alternative of separate per-view geometry logic would diverge as the user moves among Office, Tree and Graph. A persistent auto-tiling mode would also reposition later opens, contrary to the chosen one-shot behavior.

### Treat docked and inline Inspectors as arrangement participants

Keep each Inspector's dock membership and resource state in the conversation registry. An arrangement gives the docked Inspector temporary free geometry. In Tree, temporarily portal the inline Inspector into a shell overlay at that geometry, retaining its exact leaf as the return target. Do not clone its content or terminal owner. Capture each participating instance's prior geometry and dock/inline presentation before its first arrangement; later presets retain that baseline. Restore positions returns still-open instances to those captured targets. New instances do not inherit the arrangement; closed instances are not resurrected. An explicit dock-position action clears the temporary geometry for that Inspector.

This is more involved than tiling only floating windows, but it is necessary for the requested all-visible-Inspector behavior and avoids an apparently broken control when a docked window is on screen.

### Keep desktop geometry across compact and view transitions

Arrangement coordinates belong to the desktop visual stage and are clamped when that stage changes. Moving to Spaces suspends visual Inspector presentation and retains geometry without arranging the hidden windows. Compact mode shows one active Inspector and must not overwrite saved desktop placement with its full-screen compact bounds. Returning to a desktop visual view restores or clamps the desktop arrangement. Existing per-window browser geometry remains local presentation state; use the qualified tab key for new terminal-window saves and read an old pane-key entry once when available so existing users do not lose their last position. Arrangement baseline is session-local because windows themselves are not restored across browser reloads.

## Risks / Trade-offs

- **Many windows cannot tile at ordinary desktop sizes** → disable infeasible Rows, Columns or Grid options with a clear reason; Cascade and manual placement remain available when their reachability constraints fit.
- **A Tree inline portal can remount a terminal during arrangement** → transfer the same owner to a temporary overlay and test exact attachment count, focus and restore to the original leaf.
- **A fifth or sixth floating window obscures part of a Grid** → keep its header reachable, preserve its free geometry and frontmost order, and leave all four tiled window headers accessible for raising.
- **Tab grouping changes the current pane-based Inspector behavior** → retain pane-specific header/resources and exact selected-pane focus while giving the tab one stable window.
- **Background layout replies can race with split, move or reconnect** → fence by lease and tab ancestry and fall back to a loading/error state until a matching current layout arrives.

## Migration Plan

No service data or protocol migration is required. Read existing pane-keyed local window geometry as a one-time fallback for a tab window, then save it under the tab key. Rollback can ignore the new browser geometry entries; Herdr pane state and sessions are unchanged.

## Delivery trial

Implement this as a bounded multi-agent trial after the proposal is accepted. One agent owns the pure arrangement resolver and its focused tests. A second owns tab-scoped layout observation and the reusable terminal presenter. The primary agent integrates the shared shell control, window registry and Tree portal transitions after the interfaces are agreed; only one agent writes a shared source file at a time. An independent agent reviews the integrated candidate against the scenarios and terminal ownership invariant before the ready PR. Use the PR #109 template to record each role's actual model, usage boundary, tokens, elapsed time, repeated checks and review repairs. Compare the resulting record with the dated process baseline without attributing a single task's cost difference solely to agent topology.
