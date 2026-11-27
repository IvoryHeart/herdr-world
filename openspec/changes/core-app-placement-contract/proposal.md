## Why

World treated app adoption labels and the output-only `where` caption as the
app's layout. Once a desktop app adopts a terminal, its `herdr-app` document
owns membership and names; phones consume that layout. Label-only moves and
caption naming can therefore disagree with the apps (#1435).

## What Changes

- Observe the app document read-only at connect and on local document events
  and missed cuts. Adopted membership and names precede World overrides and
  labels in the single shared read model.
- Retain existing launch labels for desktop adoption. Refuse moves of adopted
  terminals or unknown app ownership, explaining that placement belongs to the app.
- Stop interpreting `where` as a name. Preserve the stacked change's derived
  name memory and folder/tab/agent fallback for otherwise unnamed rooms.
- Correct fixtures and reopen Q8 desktop/phone acceptance. No app document writes.

## Capabilities

### Modified Capabilities

- `herdr-core-runtime`: app layout observation, placement authority and naming.

## Impact

Framed client, mirror, runtime, shared topology, moves and their consumers/tests.
No new durable store, dependency or view-local state. Crew parentage changes
remain in the dispatcher's repository.
