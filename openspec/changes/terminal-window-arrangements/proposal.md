## Why

People can open several live World Inspectors but must position every window by hand to compare terminals. A Herdr split is visible in Spaces yet a floating Inspector currently presents only the selected pane, making the two presentation models disagree.

## What Changes

- Add one compact arrangement control to the shared desktop tab bar for the currently visible, already open windows. Offer diagonal Cascade, side-by-side Columns, top-to-bottom Rows, a four-corner Grid and Restore positions; fitting presets use the available stage without covering the tab bar and preserve reachable window headers. A fifth or sixth Inspector in Grid remains floating above the four tiles.
- Arrange complete Inspector presentations, including the visible docked Inspector. A Tree inline Inspector temporarily receives window geometry while arranged, retaining its qualified conversation and return path to its leaf. Office, Tree and Graph use the same arrangement model; Spaces participates through the same shell interface, with its single native terminal surface requiring no rearrangement today. Compact layouts keep their current one-active-Inspector presentation.
- Present a Herdr tab's actual split-pane layout when Terminal is selected in an Inspector. Sibling panes in one tab share one Inspector window; selecting a pane through any visual view focuses that window and selects its pane-specific resources. Reuse the existing terminal owner and Herdr layout; do not create, close or rearrange Herdr panes as a side effect of arranging windows.
- Keep arrangements as explicit actions on windows open at the moment of invocation. Later opens retain their normal placement until another arrangement is chosen. Arranging never opens background Herdr tabs as new windows.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-surfaces`: define shared window arrangements, responsive and lease-safe behavior, and split-pane Terminal presentation in World Inspectors.

## Impact

The shared tab bar and World Inspector registry/geometry, the Spaces and Inspector terminal layout presenters, tab-scoped layout observation, terminal ownership and browser acceptance tests are affected. The service and Herdr RPC contract need no new mutation method. The current Roamgate client has split-pane controls but no comparable window arrangement control; this is a Herdr World presentation feature.

The design must preserve the Tree inline return path and handle up to one docked plus five floating Inspectors. The scope excludes opening additional Herdr tabs as windows.
