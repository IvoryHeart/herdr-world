## Why

On a phone, Town folded its civic buildings into small signs: the library and
observatory became signs on the town center's wings with no building, the
post office's sign shrank to marks and numbers, and the warehouse and harbour
each added a sign on the center. A phone's Town should look and work like a
wide one: each place is a building you can find and tap.

## What Changes

- A narrow (phone or portrait) Town stands the library and observatory in
  the wide town's civic row, right of the town center on the first street;
  the town grows to the right to hold them and the harbour moves with its
  edge.
- The post office keeps its full sign on a phone, centred over its roof with
  its counts stacked so it stays over its own house and on screen.
- The folded signs on the town center (library, observatory, warehouse,
  Shipyard signpost) and the post office's folded sign are removed. The
  harbour is reached by panning, as every other building is; the center's
  Buildings ring still opens every place.
- The phone's first view is unchanged: the town center, the post office and
  the first building. Wide Towns are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-shipyard`: a narrow Town reaches the harbour by panning, with no
  signpost on the town center.
- `world-surfaces/town`: a narrow Town stands every civic building.

## Impact

- Town layout, lots, landscape, places and painter (`web/src/world/town/`).
- The civic components' narrow paths and styles; their tests.
- No data, storage or World changes.
