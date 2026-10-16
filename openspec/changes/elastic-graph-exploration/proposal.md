## Why

Phone Graph currently replaces the canvas with a hierarchy, duplicating Tree
instead of offering the desktop spatial experience. The owner finds the preview
usable but has not accepted its Graph direction and particularly values the
elastic, playable movement remembered from earlier releases.

## What Changes

- **Deferred:** finish [Office](../responsive-growing-office/proposal.md) first.
  This proposal records a later investigation; it does not authorize applying the
  prototype, replacing Graph physics or changing Tree navigation now.
- Establish a real Graph on phones and a common desktop/mobile interaction model:
  inspect a node without replacing the map, disclose children explicitly, and
  retain direct manipulation, pan, zoom and qualified context.
- Recover or preserve the elastic response that makes moving nodes enjoyable,
  alongside readable labels, predictable selection and stable settled positions.
  Rigid group dragging in the study is not acceptance evidence for that feel.
- Compare circles and cards after recovering the desired movement. The existing
  desktop appearance is an acceptable baseline; neither proposed shape is a final
  decision. No layout or spring constants are selected by this proposal.
- Revisit the requested Tree cleanup in this work: consider muting or retiring
  its standalone destination while retaining accessible browsing and deciding
  compatibility for saved Tree routes before removal.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-surfaces`: target direction for elastic Graph interaction across desktop
  and mobile. The draft delta records outcomes; implementation design remains open.

## Impact

Future browser Graph projection, layout/simulation, canvas input, camera and
disclosure preferences, accessible browsing and Graph tests. Tree and shell routes
would be affected only if their consolidation is chosen later. Operational host,
runtime and terminal ownership remain shared contracts.

## Status and resumption

Parked at the owner's request. Do not start implementation from this proposal or
treat the interactive study as approved. Resume after Office, identify and run the
historical reference, compare its drag/release/settling behaviour with the current
simulation, and return with a small interaction comparison for the owner.

The owner recalled approximately version `0.1.1`; the exact release and whether
it contains the preferred behaviour have not been verified. Investigate the
actual tagged implementation rather than assuming a historical cause or copying
old runtime/renderer boundaries. Only then settle interaction/pinning rules,
shapes, Tree migration, design and implementation tasks.
