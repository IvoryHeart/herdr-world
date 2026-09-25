## Why

People can open several live World Inspectors but must position every window by hand to compare terminals. Spaces shows one active tab at a time even when several Herdr tabs are open. A Herdr split is visible in Spaces yet a floating Inspector currently presents only the selected pane, making the two presentation models disagree.

## What Changes

- Add one compact arrangement control to the shared desktop tab bar. Offer Single (one active window filling the stage), diagonal Cascade, side-by-side Columns, top-to-bottom Rows, a four-corner Grid and Restore positions. Fitting presets use the available stage without covering the tab bar and preserve reachable window headers. Grid tiles four windows and keeps any additional ones floating above them.
- Treat Spaces' current full active-tab presentation as Single. In Spaces, arrange the focused workspace's already open Herdr tabs as terminal windows; no new Herdr tabs or sessions are created. Its one workspace Inspector follows only the active tab and pane. A Spaces tab window owns its terminal panes even when that Inspector has Terminal selected; the Inspector offers a focus action instead of another attachment. In Office, Tree and Graph, arrange only already open Inspector conversations, including the visible docked Inspector. A Tree inline Inspector temporarily receives window geometry while arranged, retaining its qualified conversation and return path to its leaf. All four views use the same arrangement control and geometry resolver; compact layouts show one active window.
- Present a Herdr tab's actual split-pane layout when Terminal is selected in an Inspector. Sibling panes in one tab share one Inspector window; selecting a pane through any visual view focuses that window and selects its pane-specific resources. Reuse the existing terminal owner and Herdr layout; do not create, close or rearrange Herdr panes as a side effect of arranging windows.
- Keep multiwindow arrangements as explicit actions on eligible windows at the moment of invocation. Later opens retain their normal placement until another arrangement is chosen. Single follows the active tab or Inspector as focus changes. Spaces may reveal already open background tabs in its stage, but arranging never creates a Herdr tab, pane or session.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-surfaces`: define shared window arrangements, responsive and lease-safe behavior, and split-pane Terminal presentation in World Inspectors.

## Impact

The shared tab bar, Spaces tab presentation, World Inspector registry/geometry, Spaces Inspector focus, tab-scoped layout observation, terminal ownership and browser acceptance tests are affected. The service and Herdr RPC contract need no new mutation method. The current Roamgate client has split-pane controls but no comparable window arrangement control; this is a Herdr World presentation feature.

The design must preserve the Tree inline return path and handle up to one docked plus five floating Inspectors. The scope includes displaying existing Herdr tabs together in Spaces and excludes creating tabs as an arrangement side effect. Review clarified four contracts: live tab identity differs from saved geometry identity; pane focus inside a split Inspector updates its resources; Spaces tab windows retain terminal ownership over the Spaces Inspector Terminal resource; and Single preserves ordinary docked Inspector replacement.
