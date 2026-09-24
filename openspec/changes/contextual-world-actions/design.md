## Context

The existing `CommandCombobox` owns the inherited model action definitions and the World shell
supplies selected-host `WorldObject` projections plus `openTerminalById`/Inspector lifecycle. The
cleanup branch shares the query UI, but it must distinguish model actions from actions that need a
visual target. Model actions are valid from every projection; terminal focus needs a view-aware
dispatcher so it cannot attach a hidden Spaces terminal or change the current visual route.

## Decisions

### Use one palette with an explicit handled-action boundary

`CommandCombobox` keeps the complete action catalog and common keyboard/selection behavior. Its
action runner calls an optional dispatcher before the model callback and allows the dispatcher to
report that it handled or blocked the action. A handled World focus action never invokes the
Spaces terminal callback; a model action for which World has no special handling falls through to
the existing shared store/dialog callback. This preserves feature parity while making the
target-sensitive ownership boundary observable and testable.

### Register the World dispatcher from the mounted visual surface

`WorldFoundationApp` holds a stable dispatcher ref and passes it to the shared shell. The mounted
`WorldControlPlane` registers a handler for the current visual presenter. Registration is cleared
on teardown and is gated by the active view, so a hidden visual presenter cannot intercept Spaces
actions.

### Resolve targets from the selected, current-generation WorldObject

World action keys are translated to `WorldObject` leaves using connection-qualified native IDs.
`Focus tab` chooses the exact tab's focused pane when available, otherwise its deterministic first
pane. `Focus agent` uses the exact pane identity. A target is handled only
when it is actionable, belongs to the selected connection, and matches the current runtime
generation. Missing or stale targets return `false` so no hidden Spaces callback is invoked.

### Reuse the existing Inspector admission path

A handled terminal action calls the existing `openTerminalById` path. That path performs qualified
focus through `focusWorldNode`, admits the entity only after focus succeeds, and applies the current
Office/Tree/Graph Inspector presentation. The action does not change `view`, selected host, or
terminal ownership. Rejected focus reports the existing World error and publishes no mismatched
Inspector context.

### Preserve the complete model action catalog

Visual routes expose the same model action catalog as Spaces. Workspace, tab, pane, file and
worktree actions use the existing shared store and shell-owned dialogs, so they remain available
and retain their existing endpoint/capability guards. Only terminal focus actions with a
generation-qualified World target are intercepted for view-preserving Inspector admission. No
visual action is routed to the hidden Spaces terminal surface merely because its callback was
defined in the inherited component.

## Constraints and Risks

- The command palette can be opened while a visual route is active and must retain the complete
  model action catalog; target-sensitive focus actions additionally require the current qualified
  World projection.
- A tab may have multiple panes. The focused-then-first resolution must be deterministic and remain
  bounded by the selected host snapshot.
- Existing action keyboard shortcuts must use the same handled boundary as pointer selection.
- The visual Inspector remains the only terminal presenter while a visual route is active; hidden
  Spaces must not mount a second `TerminalView` for that terminal.
