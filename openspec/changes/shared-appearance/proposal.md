## Why

Operators need the same appearance controls from every terminal window, including
on phones where a window covers Board. Colour is already shared across views,
but the current header does not provide the complete avatar, native tab name and
manual status editor described in issue #221.

## What Changes

- Extend the existing title-bar colour popover into one common appearance editor
  for desktop and mobile, reached from Board, Town, Desk and Spaces.
- Follow the issue's proposed scopes: colour belongs to the tab, renaming calls
  Herdr `tab.rename`, and an agent avatar may belong to an individual pane.
- Add a short tab-level manual status message, matching the issue's Board
  card, Town desk and Spaces tab-tooltip examples. Runtime state badges and their
  colours remain system-defined.
- Keep appearance in the World service using immutable connection identity,
  entity kind/native ID and terminal-ID continuity evidence, following Board
  anchors. Specify migration from Board's existing colour storage without two
  independent authoritative copies.
- Reuse bounded palette/avatar choices and provide reset controls. Uploads and
  upstream Herdr annotation work remain outside this change.
- Keep workspace icons and status messages outside this change, following the
  owner's scope decision on issue #221.

## Capabilities

### New Capabilities

None; appearance extends the existing World surface contract.

### Modified Capabilities

- `world-surfaces`: shared appearance editing and projection, native tab naming,
  colour storage continuity/migration, and desktop/mobile access.

## Impact

The change affects the Inspector/mobile terminal header, shared service metadata,
Board colour compatibility, and appearance consumers in Board, Town, Desk and
Spaces. Native renames stay qualified by connection and current runtime. Profile
look defaults remain available when an appearance override is reset. User guides,
the knowledge map, current requirements, consumer evidence and a changelog
fragment will be updated with implementation. No crew tooling changes are planned.

## Scope Decision

The owner confirmed on issue #221: tab name, colour, status message and per-pane
avatars in the terminal title bar. Workspace icons and status messages are out
of scope and will be handled separately at workspace level. Existing workspace
colour and native naming controls retain their current scope.

## Acceptance Evidence

- Two browsers and all views resolve the same saved appearance.
- Split panes share their tab colour/name while retaining independent avatars.
- A failed rename cannot create a shadow name or report a native rename success.
- Manual appearance never changes runtime status or its semantic colours.
- Retired runtime reads and conflicting terminal witnesses cannot authorize a
  write, rebind saved appearance, or fall back to another connection.
- Migration and reset preserve defined inheritance and isolate connection IDs;
  unavailable hosts do not count as proof of deletion.
- The common editor is reachable and usable on desktop and phone viewports.
- Complete required verification and independent PR review precede delivery.
