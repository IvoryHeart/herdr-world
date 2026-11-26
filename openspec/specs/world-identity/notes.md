# world-identity notes

[Contract](spec.md). Navigation and usage guidance; contracts live in OpenSpec.

**Surfaces:**

- Qualified host, room, desk, pane and agent identities.

**Code:**

- `server/src/storage/world-ids.ts`
- `server/src/world/binding-resolution.test.ts`
- `shared/worldIdentity.ts`
- `openspec/changes/world-agent-identity/agent-identity.qnt` (design-stage agent identity model; moves to `quint/` with its adapter)

**Pitfalls:**

- Names are display labels; durable identity is qualified by runtime.
