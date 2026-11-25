# world-harness-integration notes

[Contract](spec.md). Navigation and usage guidance; contracts live in OpenSpec.

**Surfaces:**

- Settings Integrations Agents and local harness installation.

**Code:**

- `server/src/cli/world-skill.ts`
- `server/src/cli/world.ts`
- `server/src/cli/world-agents.ts`
- `server/src/cli/integration.ts`
- `server/src/cli/integration.test.ts`
- `server/src/integrations/`

**Pitfalls:**

- Installation is explicit and runtime/host specific.

## Usage reference

World skill v7 includes runtime-neutral `runtime ls`, `agent ls` and verified
`agent read`, qualified targets and explicit refusal reasons. Reinstall or sync
an outdated integration to refresh its guide. Native runtime manuals remain
optional documentation pointers; World agent reads use typed service ports.
