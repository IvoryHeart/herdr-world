import { expect, test } from "bun:test";
import { townHitTest } from "./townHitTest";
import { layoutTown, townSeat, type TownCell } from "./townLayout";
import type { TownModel } from "./townModel";

/** One room with desks of one, two and four panes, each pane an agent. */
function scene() {
  const panes = { solo: 1, pair: 2, team: 4 } as const;
  const deskKeys = Object.keys(panes);
  const { layout } = layoutTown(
    {
      hosts: [{ key: "host", displayOrder: 0 }],
      rooms: [
        {
          key: "room",
          hostKey: "host",
          order: 0,
          deskKeys,
          deskSeats: Object.values(panes),
        },
      ],
    },
    "wide",
  );
  const desks = new Map(
    Object.entries(panes).map(([key, count]) => [
      key,
      {
        key,
        paneDevices: Array.from({ length: count }, (_, seat) => ({
          key: `${key}/pane-${seat}`,
          agentKey: `${key}/agent-${seat}`,
        })),
      },
    ]),
  );
  const agents = new Map(
    [...desks.values()].flatMap((desk) =>
      desk.paneDevices.map((device) => [device.agentKey, {}] as const),
    ),
  );
  const model = { desks, agents } as unknown as TownModel;
  const cells = new Map<string, TownCell>(
    layout.buildings[0]!.rooms[0]!.cells.flatMap((cell) =>
      cell.deskKey ? [[cell.deskKey, cell] as const] : [],
    ),
  );
  const hit = (x: number, y: number) =>
    townHitTest(
      {
        layout,
        model,
        level: "desk",
        roofAlpha: () => 0,
        standing: () => [],
        zoom: 2,
      },
      x,
      y,
    );
  return { cells, hit, panes };
}

test("a tap on a drawn seat selects that seat's agent", () => {
  const { cells, hit, panes } = scene();
  for (const [deskKey, count] of Object.entries(panes))
    for (let seat = 0; seat < count; seat += 1) {
      const geometry = townSeat(cells.get(deskKey)!, seat);
      // The character's body: above the table for top seats, below for others.
      const y = geometry.top ? geometry.tableY + 12 : geometry.tableY + 44;
      expect(hit(geometry.cx, y)).toEqual({
        kind: "agent",
        key: `${deskKey}/agent-${seat}`,
      });
    }
});
