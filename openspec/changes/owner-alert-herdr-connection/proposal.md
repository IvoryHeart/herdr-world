## Why

When the default host was a herdr-core connection, every owner alert for a
question from a herdr-core agent (and from an unplaced asker) targeted that
core connection. herdr-core has no notifications, so World refused every one
of them, and Needs you only said "Owner alert was not shown".

## What Changes

- The Herdr connection that alerts the owner for a herdr-core or unplaced
  asker is the default connection when it is a Herdr connection, otherwise the
  first saved Herdr connection on this computer; never a herdr-core connection.
- With no such connection, no alert is sent and Needs you says the owner was
  not alerted.
- Dispatch is unchanged: the captured connection's current lease, no fallback.

## Capabilities

### Modified Capabilities

- `ask-answer-delivery`: the owner-alert connection for herdr-core and
  unplaced askers.

## Impact

Ask recording (`server/src/world/world-cli-asks.ts`), the selector
(`server/src/world/owner-alert-connection.ts`), the ask's captured runtimes
(`server/src/service/world-ask-peers.ts`) and the Needs you/Town delivery note
(`web/src/world/worldAsks.ts`).
