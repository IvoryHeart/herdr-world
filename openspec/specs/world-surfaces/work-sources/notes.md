# Work Sources notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Settings enables/configures GitHub and Jira; Board Work and Town desk badges show their items.
- Pull-request cards and confirmation sheets expose head-qualified merge/close/ready actions.
- Phone cards use the same source facts and confirmations.
- TUI/core agent links require qualified checkout/session evidence; sources run on the World service.

**Code:**

- `shared/worldSources.ts`
- `server/src/sources/service.ts`
- `server/src/sources/github.ts`
- `server/src/sources/actions.ts`
- `web/src/world/worldSources.ts`

**Tests:**

- `server/src/sources/github.test.ts`
- `server/src/sources/actions.test.ts`
- `server/src/sources/pullRequestDetail.test.ts`
- `server/src/sources/links.test.ts`

**Pitfalls:**

- Weather and Shipyard have separate specs; the warehouse reuses source observations.
- A successful list refresh cannot refresh expired PR action detail.
- Shared GitHub login does not establish reviewer identity; explicit sender claims do.
- Exact head, source generation, detail expiry and protection still apply at dispatch.
- PR action verbs are intentionally absent from the World CLI.
