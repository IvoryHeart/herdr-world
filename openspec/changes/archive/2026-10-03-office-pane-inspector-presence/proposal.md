## Why

Office, Tree and Graph can show several independent Inspector windows, but a terminal file link can select a file without switching the originating window to Files. In visual views, selecting a pane or terminal window can also leave keyboard input directed to another pane or unfocused, and a newly created Office desk does not immediately present its terminal. Office additionally gives agents working in extra panes no lasting device and sends completed agents to the bar instead of the shared reception where attention is needed.

## What Changes

- Open a terminal file link in the Files resource of that exact terminal's Inspector window, with the linked file selected and that window brought forward.
- Make explicit pane and terminal-window selection in Office, Tree and Graph establish the same exact pane keyboard target and terminal focus that users expect in Spaces. Creating a desk in Office opens its admitted terminal and exposes its multi-pane state.
- Place clickable pane-linked devices and grouped working agents around the owning tab desk in Office. The devices remain when agents move to reception or the bar and disappear when their panes close.
- Route `done` agents to their host's shared reception alongside `blocked` agents. Show `✔` for done and `?` for input needed, while `idle` agents stay at the bar. Keep existing completion drops and seen markers.
- Extend reception presentation with bounded standing positions and a visible overflow count plus roster access when needed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-surfaces`: exact Inspector resource and pane focus handoff, Office desk activation, pane devices, and status-based reception placement.

## Impact

The work affects browser Inspector routing and terminal focus, Office projection, geometry, Pixi rendering and semantic targets, and focused/browser UI coverage. It does not require a Herdr or World service API change. The attached Office mockup illustrates placement and status cues; it is not a production asset.
