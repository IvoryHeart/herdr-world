## Why

Usage counts each agent's runs, but a finished agent in Apartments showed
nothing of what it cost or how long it worked. A resident should show its
own week of usage, worded as a live agent's card line, and open Usage's
Breakdown on that agent alone.

## What Changes

- A resident record gains optional `usage_agent_ids`: the agent IDs
  `world.usage.analytics` counted it under while World watched it, newest
  last and bounded. A resumed session adds its new ID to the record it
  replaces. Older and found records read as none; no migration.
- The Apartments list and the opened resident show "This week: at work … ·
  waited on you … · … tokens", "tokens and cost not available for this
  harness" for a harness World reads no log of, and "This week: usage
  unknown" when no counted run is in the seven days Usage keeps.
- In Town the line opens Usage on Breakdown filtered to that resident: an
  Agent chip replaces Group by, the total reads "This agent", and the chip's
  × shows every agent again.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `world-surfaces/apartments`: residents show their usage.
- `world-surfaces/town`: Usage's Breakdown filters to one agent.
- `world-storage`: resident records carry optional, leniently read usage
  agent IDs.

## Impact

Server: `shared/apartments.ts`, `server/src/world/apartments.ts`,
`server/src/storage/apartments.ts`. Browser: `web/src/world/apartments/`,
`web/src/world/usage/`, `web/src/world/town/TownUsageLens.tsx`. Notes:
`openspec/specs/world-surfaces/apartments/notes.md` and
`openspec/specs/world-surfaces/town/notes.md` (Usage Breakdown).
