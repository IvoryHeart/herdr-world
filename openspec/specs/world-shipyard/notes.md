# world-shipyard notes

[Contract](spec.md). Navigation and usage guidance; contracts live in OpenSpec.

**Surfaces:**

- Town harbour, Board Work Releases and shipyard CLI/API.

**Code:**

- `web/src/world/shipyard/shipyardModel.ts`
- `web/src/world/shipyard/ShipyardPipeline.tsx`
- `web/src/world/town/TownShipyard.tsx`
- `web/src/world/town/TownWarehouse.tsx`
- `web/src/world/shipyard/shipyardModel.test.ts`
- `web/src/world/town/TownShipyard.dom.test.ts`
- `web/src/world/town/TownWarehouse.dom.test.ts`
- `server/src/shipyard/service.ts`
- `server/src/shipyard/github.ts`
- `server/src/shipyard/instances.ts`
- `server/src/shipyard/github.test.ts`
- `server/src/shipyard/service.test.ts`
- `server/src/service/shipyard.test.ts`
- `server/src/shipyard/`
- `server/src/cli/shipyard.ts`
- `web/src/world/shipyard/`

**Pitfalls:**

- Missing or stale release data grants no release authority.

## Usage reference

## Shipyard

- `herdr-world shipyard list|show` and the same-origin
  [Shipyard API](../../../docs/shipyard-api.md) read GitHub releases, tags, workflow health
  on the observed main commit and merged changes waiting after the release
  baseline. All authors count; membership follows the commit graph, not dates.
- Channels are stable or prerelease. Drafts and bare tags do not count as shipped.
  Missing, stale, diverged or shortened data stays explicit; it never means
  “nothing waiting” or permission to release. The existing GitHub Sources switch
  and service user's `gh` sign-in apply. Reads share a bounded cache and deadline.
- Running World listeners report their versions, ports and known source branches
  in a private local registry. Isolated previews can opt into one shared registry;
  expired reports are stale and have no open action. Only fresh loopback reports
  provide navigation URLs, usable from the service machine. No remote host or
  port discovery runs, and agent runtimes are not treated as World deployments.
- V1 provides navigation links only: no release/tag creation or deployment
  changes. `herdr-world shipyard demo --scenario stale|limited --json` exercises
  synthetic rare states without a service or credentials.
- **Town harbour**: a wide Town ends at its right-most edge in the sea, which
  runs on off the map. The streets end at a stone promenade; one shipping lane
  per project crosses the water from it, each in its own colour (eight colours
  that repeat), named on a board with its flag at the pier's root. Projects are
  the repositories the Shipyard suggests (up to eight) plus the one chosen in **Work →
  Releases**, which comes first. On a lane, the hull on the slipway is the next
  release, with the count of merged pull requests waiting for it (`200+` when
  shortened, `?` unknown); the latest three releases are ships moored along the
  pier, newest first, prereleases with orange hulls and a green pennant while a
  World on this computer runs that version. The lighthouse at the pier's head
  is main's checks (green passing, red failing, yellow running, grey unknown).
  The Shipyard sign counts projects and those with main failing or out of date.
  A board or hull opens that project in **Work → Releases**; a ship opens its
  release card with **All releases**. A new release sails in once, only in its
  own lane, and is announced; the first read and a repository change stay
  still. More projects than the sea holds (about thirteen on a one-building
  town) end in a **+N more** lane listing the rest by name and state; each opens
  in **Work → Releases**. Stale data fades a lane, greys its lamp and says
  **Out of date**; so does a failed read of that one project, keeping its
  last ships, and a failed read of World itself, and then every
  running World reads as stopped reporting without **Open**. GitHub off or no
  repository leaves an empty sea and says how to go on. A phone or portrait
  Town has the same harbour right of its stacked buildings: drag or pinch to
  reach it, or tap the **Shipyard** signpost on the town center's left wing
  (a dot per project in its colour and lamp, and an arrow), which flies to
  the sea with the promenade and a whole pier across the screen. Calm Town
  and reduced motion stop the bobbing and
  sailing. Open pull requests are the warehouse's, not the harbour's.
- **Work → Releases** (Board's Work lens and Town's harbour): main's checks,
  waiting changes, shipped releases and running Worlds, with links to GitHub
  and **Open** only for fresh loopback Worlds (usable on the service machine).
  Waiting changes list the merged pull requests the commit graph proves and
  the total commit count; World does not guess which commits were pushed
  directly. The repository select, including **Another repository…**, is remembered per
  browser. **Read GitHub again** forces one bounded refresh.
- Testing only: `?shipyardFixture` (or `=failing|stale|limited|off|empty|offline`)
  shows synthetic data without GitHub, three projects; `=many` shows sixteen,
  more lanes than a town's sea holds. The page drops the parameter at once.
  `offline` answers once, then fails every read as if World stopped answering.
