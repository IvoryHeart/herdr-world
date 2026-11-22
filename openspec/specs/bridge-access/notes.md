# bridge-access notes

[Contract](spec.md). Navigation and usage guidance; contracts live in OpenSpec.

**Surfaces:**

- Service startup, private-network access, uploads and qualified RPC admission.

**Code:**

- `server/src/herdr/cli.ts`
- `server/src/http/herdr-setup.test.ts`
- `server/src/verbs/registry.ts`
- `server/src/verbs/policy.test.ts`
- `server/src/service/world-service.test.ts`
- `server/src/bridge/`
- `server/src/verbs/`
- `server/src/http/`
- `server/src/index.ts`

**Pitfalls:**

- Keep one browser origin; shell and transport operations need qualified authority.
