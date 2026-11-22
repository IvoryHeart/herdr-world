## Why

The Shipyard harbour (#1079) drew a pier for every lane its sea could hold and gave a lane to every suggested repository, so it showed empty, placeholder lanes. Ships also drew over the lighthouse, hiding its red/green light (#1148).

## What Changes

- A project gets a lane only once a read of its GitHub releases lists at least one published release. A project not read yet, with no release, or whose read finds GitHub off or signed out has no lane or pier; it stays in Work → Releases, and an empty harbour's sign says why.
- Piers are drawn one per shown lane, including the "+N more" lane.
- Each lighthouse stands on its pier head past the last berth, above ships, and its lamp keeps a visible size at every zoom and on a phone.
- The harbour's sign and lanes sit as one block, vertically centred on the harbour's side of Town.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-shipyard`: the Town and Board presentation requirement gains the lane rule, the lighthouse placement and two scenarios.

## Impact

Browser only: Town's harbour geometry, DOM layer and art. No server, API or dependency change.
