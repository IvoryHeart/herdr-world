# Town notes

[Contract](spec.md). Navigation guidance only; OpenSpec ignores this file.

**Surfaces:**

- Choose Town in the view picker or open /town; use buildings, room cards and desks.
- Reception, board sign/Summary, room/table popovers and the town center ring are entry points.
- Settings exposes lenses, calm motion, buildings and reception preferences; phones retain semantic targets.
- TUI and core share Town; core pins derive from herdr.pinned, TUI pins from World settings.

**Code:**

- `web/src/world/TownView.tsx`
- `web/src/world/town/TownCanvas.tsx`
- `web/src/world/town/townLayout.ts`
- `server/src/world/observability.ts`

**Tests:**

- `web/src/world/town/TownCanvas.test.ts`
- `web/src/world/town/TownCanvas.fold.test.ts`
- `web/src/world/town/townLayout.test.ts`
- `web/src/world/town/townReceptionFilter.test.ts`

**Pitfalls:**

- A host building may contain several independently qualified runtimes.
- Room counts cover all observed agents; drawn desks are a native-order prefix.
- Pins and selection do not pull hidden desks across the fold boundary.
- Moving rooms on the canvas is separate from moving native desks; see town-moves.
- CLI desk pins/moves use their feature contracts, not canvas coordinates.
