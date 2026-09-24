## Why

World's shared top-bar search and Actions palette currently have incompatible ownership
boundaries. The palette was designed around the Spaces workspace, while Office, Tree and Graph
already expose generation-qualified projections and Inspector admission. Treating the palette as
Spaces-owned either targets a hidden terminal surface for focus actions or tempts the UI to hide
model actions that should work from every projection.

The owner wants one search/action surface, but actions must respect the view in which they are
invoked. This change defines the missing World interaction seam instead of allowing visual routes
to fall through to Spaces.

## What Changes

- Keep one command palette/search surface and the complete inherited model-action catalog in the
  top bar across Spaces, Office, Tree and Graph.
- Add an explicit World action dispatcher for actions that need a generation-qualified visual
  target and a view-preserving presentation. Existing workspace, tab, pane and worktree actions
  continue to execute through the shared model callbacks from every projection; visual file and
  diff actions use the World Inspector conversation so they do not update an unrendered
  Spaces-only Inspector.
- Make terminal focus actions from Office, Tree and Graph resolve the selected host and current
  runtime generation, perform exact pane focus, and open or focus the existing shell-owned
  Inspector without changing the current view.
- Preserve the existing Spaces action behavior when Spaces is active and preserve the same model
  action behavior when a visual projection is active.
- Add regression coverage for action parity, contextual focus, stale/foreign target rejection,
  and the guarantee that hidden Spaces receives no terminal attachment or browser shortcut.

## Capabilities

### Modified Capabilities

- `world-surfaces`: contextual command actions and view-preserving Inspector admission.

## Non-Goals

- No second command palette, World-specific terminal implementation, runtime store, WebSocket,
  or terminal owner.
- No implicit host activation, cross-host target lookup, or fallback to the hidden Spaces terminal
  surface from a visual route.
- No redesign of the Pixel Office, Tree, Graph, or Inspector visual compositions beyond the action
  entry point needed to preserve their existing contracts.

## Acceptance Evidence

- OpenSpec delta validates strictly.
- Unit tests cover action classification and exact World target resolution.
- Mounted browser coverage opens the palette from a visual view, invokes `Focus tab`, opens Files
  and Changes resources, and verifies that the view remains active while qualified Inspector
  targets become visible and focused; it also exercises a shared model action such as `Close pane`
  from that same palette.
- Failure coverage proves stale, foreign, missing, or rejected targets do not dispatch a Spaces
  focus and do not publish mismatched Inspector identity/resources.
- Lint, typecheck, focused tests, and the complete repository check pass before the replacement PR
  is opened or updated.
