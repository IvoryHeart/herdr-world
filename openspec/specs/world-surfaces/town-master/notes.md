# Town Master notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- A new visit opens the Town Master greeting at Town's figure, Board's hub or Desk's summary.
- Phone greeting is a Back-dismissable sheet; desktop waits only for overlapping windows.
- The card and Settings share Show this on start; news Try uses feature help declarations.
- TUI/core show the same scripted greeter; it has no agent or native operation authority.

**Code:**

- `web/src/world/TownMasterGreetingHost.tsx`
- `web/src/world/TownMasterCard.tsx`
- `web/src/world/townMasterGreeting.ts`
- `web/src/world/town/townMaster.ts`

**Tests:**

- `web/src/world/townMasterGreeting.test.ts`
- `web/src/world/TownMasterCard.test.ts`
- `web/src/world/town/townMaster.test.ts`

**Pitfalls:**

- The scripted greeter differs from the agent holding the Town master chime role.
- Thirty minutes hidden starts a visit; shorter backgrounding does not.
- News-seen and greeting preferences belong to the browser, not shared settings storage.
- A docked window elsewhere on desktop must not suppress the greeting.
- There is no greeting CLI; task-summary/role assignments are separate features.
