## Why

Inspector and Spaces windows have separate movement, sizing, focus and restore
rules. Mobile controls overlay content whose terminal sizing assumes it is fully
visible. The owner approved a coordinated window and work-area redesign.

## What Changes

- Give Inspector and Spaces windows one placement, focus, minimize, maximize and
  restore model, with shared movement, edge/corner resizing and snap previews.
- Keep placement order independent of focus order. Opening, focusing or dismissing
  a window does not rearrange other windows.
- Provide a window switcher and make window close dismiss presentation; underlying
  Herdr tab closure remains an explicit tab operation.
- Fit windows and terminals into one measured work area. Use one active window on
  mobile, preserve desktop geometry, and coordinate keyboard/composer sizing. Keep
  mobile controls floating and remove the duplicate mobile tab strip.
- Preserve Roamgate-derived terminal transport, pane layouts, resource ownership,
  shortcuts and preferences behind narrow World presentation adapters.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-surfaces`: coordinated window lifecycle, predictable placements,
  accessible window switching and mobile work-area layout.

## Impact

World browser presentation, shared window controls, small App integration points,
layout styles and browser tests. No runtime protocol or service API change, no
dependency change, and no change to the recorded Roamgate source synchronization.
