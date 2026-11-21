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

## Usage reference

  - **Teams.** Tables whose agents know each other are drawn inside one wall
    with a connector: a spawned agent is joined to the agent that started it,
    and a manual group with dotted lines; stale links are faded while a host
    is offline, and dropped once its agents have closed. A team's tables that
    touch share one wall, which bends around another team's table rather than
    splitting; separate clusters of one team get a wall each, joined by a
    connector.
    Drag a table onto another table and hold it there a moment: it snaps to
    that table (**Group with …**), and dropping groups them. Town moves it to
    that room if needed and seats it in a free place touching the other
    table, on the side it came from where it can; no other table moves, and
    Herdr's tab order stays as it was. The tables keep those places until the
    room's tab order changes or the page reloads. A quick drop keeps meaning
    a move or a reorder, so the gestures stay separate.
    Drop a table you grouped on its own room's bare floor (not the free spot)
    to leave its group; a spawn link stays, since Herdr's stamp records it.
    **M** on a focused table offers the same as **Group with…** and **Leave
    the team**, and the table's accessible name lists its teammates. A
    pinned table joins a team only in its own room, and keeps its pinned seat.
### Teams and spawn stamps

World groups terminals that know each other. Each relation lists its evidence,
one entry per source, with the source's system of record and whether it holds
now: a **spawn** (Herdr pane metadata while it lives, then World's saved copy)
or a **manual Team** (saved by World). Evidence for a terminal that is gone or
on a stale host is shown as stale, not dropped. Herdr records no creator for a
tab or pane, so a spawner stamps the child:
`herdr-world stamp CHILD_PANE PARENT_PANE` (`bun run agent:stamp --` in a
checkout). Board's **Start an agent** stamps the new agent when its note is
strung to one pane. Town draws teams as walls and connectors; Board strings
related cards and groups a tab dropped on another tab, or chosen with
**Group…** and a tap; **Ungroup** undoes it. Existing saved magnetic groups
migrate automatically to kind Team; these controls continue to act on Teams.

### Groups

**Actions → Groups** opens the existing movable panel window (full screen on
phones). Filter All/Pod/Team/Room/Desk, then open a row for member roles, live
status, linked open PR cards, the ordered Now list and recent sender attribution.
The roster shows shared reviewers with rings and warns above the Pod's open-PR
limit without blocking edits. Unavailable work is unknown; failed refreshes are
labelled cached. Away and ambiguous addresses never contribute live work/status.

Town's open **Summary** shows a **Pods** section after Hosts and rooms, with
the same status, first Now item and source-qualified PR warning. Tap a Pod to
open or raise its Groups detail. Pod roll-ups do not add to reception counts.

Create Teams/Pods, add/remove members, edit roles, name/Now/limit, delete with
confirmation or explicitly promote a Team with a complete current address mapping.
Exclusive-role transfers ask first. An edit or confirmation based on an older
Board revision is refused and refreshes the roster. Add, Edit and Roles keep
their drafts open until a write succeeds; after a conflict, review the current
values and choose **Use current version** before explicitly saving again.
Current-agent selection refuses a replaced agent or a duplicate Herdr name;
rename duplicates or supply an explicit qualified address. Ambiguous member actions
inspect a qualified match without treating it as resolved. Room/Desk membership
belongs to Herdr and uses Town's move gestures or guarded CLI moves.
