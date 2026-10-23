## Why

The owner wants to see their GitHub pull requests and Jira tickets in World,
beside the agents working on them, without installing a separate Herdr plugin
for each system. World already runs a Bun service with the owner's sign-ins
and observes every agent's pane, so it can read these systems of record itself
and link their items to the agents' desks.

## What Changes

- Add built-in **sources** to the World service: GitHub (through the service
  user's `gh` sign-in) and Jira Cloud (site, account email and an API token in
  private service storage). Each is on by default, can be switched off, and
  reports `not_connected` with what to do when its prerequisite is missing.
- Link items to agents: a pull request whose head branch is an agent's checkout
  branch (in a GitHub remote of that checkout), a pull request the agent
  reported with `herdr-world agent-checkout --pr`, and a ticket whose key the
  branch names.
- Board gains a **Work** lens: pull requests by lane (In review, Fixing, Green,
  Ready to merge, Merged) and tickets by status category, each card naming its
  linked agents, which jump to their Board cards.
- Town desks show the badge of the item their agent works on (`#123 ✓`,
  `#123 ✗`, `#123 ●`, `ABC-1`).
- A **Sources** entry in World settings switches each source and configures Jira.

## Capabilities

### New Capabilities

None. This extends World surfaces with optional observations from other
systems of record.

### Modified Capabilities

- `world-surfaces`: built-in sources, their links to agents, Board's Work lens
  and Town's desk badges.

## Impact

New service modules under `server/src/sources/` and routes under
`/api/world/sources`; shared wire types in `shared/worldSources.ts`; browser
store, settings dialog, Board lens and Town badge. Settings are kept in
`settings.json` (`custom.world_sources`); the Jira token is kept in a private
`source-secrets*.json` file beside the session signing state and is never
returned to the browser. No new dependencies.
