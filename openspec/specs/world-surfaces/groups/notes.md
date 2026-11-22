# Groups notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Actions → Groups opens the roster/detail window; Town Summary Pod rows open the same detail.
- Group filters, role/membership forms and interest chips are available on desktop and phone with Back.
- CLI group/pod/team verbs include roster edits, promotion/import and explicit projected membership moves.
- TUI/core Room and Desk groups are runtime-owned projections; stored Teams/Pods remain World-owned.

**Code:**

- `shared/groups.ts`
- `server/src/world/board-groups.ts`
- `server/src/world/world-cli-groups.ts`
- `server/src/cli/world-groups.ts`
- `web/src/world/groups/GroupsWindow.tsx`

**Tests:**

- `shared/groups.test.ts`
- `server/src/world/board-groups.test.ts`
- `server/src/cli/world-groups.test.ts`
- `web/src/world/groups/GroupsWindow.test.ts`

**Pitfalls:**

- Teams use same-connection terminals; Pods use canonical agent addresses and may span hosts.
- Display names, harness labels and ambiguous matches cannot resolve membership.
- Lead/builder exclusivity is pooled per Pod; reviewer can span Pods.
- Crew role rules are not authenticated caller identity or authorization.
- Room add moves the entire desk, requires --herdr and prints every affected agent.
