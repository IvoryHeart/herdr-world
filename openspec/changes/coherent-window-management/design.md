## Context

World is derived from Roamgate v0.7.11 source. Its focused App, terminal input and
transport, native pane layouts and workspace resources must remain compatible with
future source merges. The new manager belongs to World presentation, with explicit
adapters for visual Inspector identities and workspace-local Spaces tab identities.

## Decisions

1. A pure window model owns stable admission order, separate focus order, normal
   placement, minimized/maximized state and a bounded arrangement restore snapshot.
   Window identity always retains its connection and runtime generation.
2. Shared interaction geometry supports every edge/corner, keyboard move/resize,
   pointer capture, drag cancellation and snap previews. A snapped window retains
   its anchor as the work area changes. Snapping into an occupied region overlaps
   without moving its occupant. Explicit tiling records stable participants and
   shared dividers; later admission never triggers retiling.
3. A shared frame renders window chrome and a content host. Resource and terminal
   adapters own content and qualified operations. Presentation events cannot
   accidentally close a Herdr tab or activate terminal input.
4. Layout derives from a measured work-area element in local CSS coordinates.
   Scale conversion occurs at the pointer boundary. Mobile is a projection of
   desktop state, with one active window and an accessible switcher.
5. Desktop arrangement and window-switcher controls live in the shared top bar
   so they stay reachable without a focused tab. The mobile ellipsis and its expanded menu remain floating, without reserving
   a bottom row. Mobile hides the redundant tab strip and uses the floating Tabs
   control as its single window-switching entry point, preserving tab creation and
   closure. It restores minimized windows and includes retained windows from other
   workspaces or hosts without a duplicate list icon in the third row. Arrange sits
   beside Tabs in the second row; the third row contains terminal/resource controls. The composer occupies its own content space. The existing viewport/keyboard adapter
   remains the platform compatibility boundary; geometry is not independently
   corrected in every window. Existing terminal fitting and resize synchronization
   consume the resulting content box.
6. Preserve the native Spaces Single layout and its pane owner. Arranged Spaces
   windows use the shared model and frame. Closing a presentation records its
   dismissal until explicit selection or arrangement reopens it.
7. Keep World changes in dedicated modules/styles wherever possible. Do not rename
   upstream terminal APIs, replace the transport, change the protocol, or claim a
   new upstream synchronization.

## Delivery and evidence

Keep a live branch preview on port 8789 bound to all interfaces as requested.
Use synthetic fixtures for captured evidence. Test transitions across snap,
arrange, open, focus, minimize, maximize, restore, dismissal, host retirement,
view changes and compact/desktop changes. Browser checks cover edge resizing,
UI scale, measured content bounds and terminal ownership. Preserve the existing
terminal and input regressions. Obtain independent review before PR delivery.

Current capability specs remain at the accepted baseline while this live candidate
is reviewed. This change carries the complete modified requirements and scenarios;
synchronize them on acceptance so the earlier delivered multi-host delta is not
silently rewritten during this preview.

Existing scenario titles are retained for specification continuity. Their updated
steps describe the shared frame and snap placement that replace dock/inline modes.
