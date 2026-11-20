# Town art options (#1117)

Posted on the issue: https://github.com/IvoryHeart/herdr-world/issues/1117#issuecomment-7038993228

## Local-only: preview links and login

Not posted on GitHub: the repository is public and AGENTS.md forbids publishing private hosts.

- a: http://<host>:8798/town?townArt=a&shipyardFixture&townWarehouseFixture
- b: http://<host>:8798/town?townArt=b&shipyardFixture&townWarehouseFixture
- c: http://<host>:8798/town?townArt=c&shipyardFixture&townWarehouseFixture
- now: http://<host>:8798/town?townArt=now&shipyardFixture&townWarehouseFixture

## Preview runtime

- Worktree `.agents/worktrees/town-art`, local branch `agent/town-art`: a throwaway merge of origin/main with crew/1028, crew/1098, crew/1027 and crew/1011. Never pushed. `townLibraryLot.test.ts` was dropped because it is stale after the merge.
- Art code: `web/src/world/town/townArt{Direction,Kit,A,B,C}.ts`, `townArt.ts`. Each building's existing paint function dispatches on `?townArt=`.
- World: `.agents/worktrees/town-art/.agents/preview-data/start.sh` (port 8798 on 0.0.0.0, own HOME and data folder). Log: `world.log` in the same folder.
- Synthetic Herdr session: `townart` (`herdr --session townart ...`), with demo repos in /tmp/demo-townart.
- Stop: kill the 8798 listener's PID, then `herdr --session townart server stop` and `herdr session delete townart`.

## Issue comment

> Three art directions, each shown in the real Town. Layout, signs, ships, crates and behaviour are unchanged; only the buildings' art changes. Each direction covers the post office, town center, apartments, library, warehouse, piers with their lighthouses, and the sea.
>
> **Preview:** port 8798 on the usual Tailscale address (the full links and login are in the local report; this repository is public, so the host is not posted here). The preview uses a synthetic Herdr session with demo rooms only.
>
> | Direction | Path on the preview |
> |---|---|
> | A, Storybook | `/town?townArt=a&shipyardFixture&townWarehouseFixture` |
> | B, Harbour timber | `/town?townArt=b&shipyardFixture&townWarehouseFixture` |
> | C, Civic deco | `/town?townArt=c&shipyardFixture&townWarehouseFixture` |
> | Today's art, for comparison | `/town?townArt=now&shipyardFixture&townWarehouseFixture` |
>
> The choice sticks for the browser tab, so open a link again to switch.
>
> ### A: Storybook
> The buildings are drawn the way the agents and desks are: seen from three-quarters above, with big hipped roofs of round clay tiles over short cream plaster walls and timber corners. It uses one warm palette (clay, moss and slate roofs), light from the top left, and Town's dark outline around everything. The post office has a clay roof, an envelope dormer and a pillar box. The library has a moss roof and windows full of books. The warehouse is a timber barn under slate with its doors slid open. The apartments have a plum roof. The town hall has blue wings, a clay centre and a clock tower.
> Why it fits: it shares the agents' and desks' viewing angle, outline, light and chunky shapes, so the buildings look drawn by the same hand. It is the closest match and the safest choice.
>
> ### B: Harbour timber
> A Nordic fishing town. Steep gables face the street under near-black shingle roofs, and each building's boards are painted one strong colour with crisp white trim:
> - a falu-red post office with a yellow post horn;
> - an ochre library of three gables, like books on a shelf;
> - a sea-blue boathouse for the warehouse;
> - sage twin townhouses for the apartments;
> - a white town hall with a black spire.
>
> The piers are tarred wood and the sea is cold and deep.
> Why it fits: the harbour sits at the town's edge, so a seaside town ties the shipyard to the rest. Shapes stay simple and details few, and colour identifies each building at a glance, even zoomed out.
>
> ### C: Civic deco
> Flat roofs are seen from above, like the rooms' own building, over smooth stucco fronts with rounded corners, ribbon windows and vertical fins. The palette is taken from World's own chrome (the plaques' chocolate and gold), with one pastel per building:
> - a terracotta post office with an entrance tower;
> - a teal library with glass bays of books and a roof garden;
> - a steel warehouse with a sawtooth roof, a roller door and a forklift;
> - peach apartments with wrap-around balconies;
> - a cream town hall with a stepped clock tower.
>
> The piers are concrete and the sea is teal with neat waves.
> Why it fits: it echoes the office building and World's signs, so Town and the interface feel like one product. It is the most modern of the three.
>
> ### What to compare
> - **At a glance, at home zoom:** can you name each building without reading its sign? A relies on its roofs, B on its colours, C on its shapes.
> - **Beside the rooms building, desks and agents:** which looks drawn by the same hand?
> - **Under the signs:** the library and warehouse signs sit on their rooftops. Check that each building still reads with its sign on.
> - **The harbour:** the warehouse, piers, lighthouse and sea next to the ships and crates, which are unchanged in all three.
> - **On a phone:** home shows the town center and apartments. Tap **ALL**, or pinch out, to see the harbour and warehouse. On narrow screens the post office and library fold into signs, as they do today.
>
> Once a direction is picked, the crew builds it. Nothing is pushed yet; this preview is a throwaway local merge of main with #1079, #1082, #1034 and #1107.
