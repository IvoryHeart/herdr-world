import { expect, test } from "bun:test";
import { townHitTest } from "./townHitTest";
import {
  layoutTown,
  TOWN_TILE as T,
  townSeat,
  type TownCell,
} from "./townLayout";
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
  const hit = (x: number, y: number, level: "desk" | "room" = "desk") =>
    townHitTest(
      {
        layout,
        model,
        level,
        roofAlpha: () => 0,
        standing: () => [],
        zoom: 2,
      },
      x,
      y,
    );
  return { cells, hit, panes, layout, building: layout.buildings[0]! };
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

test("the town center's hall, dome and flag are its target; the sky beside the dome is not", () => {
  const { hit, layout } = scene();
  const { x, y, w, h } = layout.center;
  const middle = (x + w / 2) * T;
  // The doors, a wing's end and the flag above the dome.
  expect(hit(middle, (y + h - 3) * T)).toEqual({ kind: "center" });
  expect(hit((x + 1) * T, (y + h - 4) * T)).toEqual({ kind: "center" });
  expect(hit(middle + 4, y * T + 4)).toEqual({ kind: "center" });
  // Beside the dome, and just outside the drawn building, is open ground.
  expect(hit((x + 2) * T, y * T + 4)).toBeNull();
  expect(hit((x + w) * T + 2, (y + h - 3) * T)).toBeNull();
  expect(hit(middle, (y + h) * T + 2)).toBeNull();
});

test("at desk level the reception lobby is its own target; above it, the building", () => {
  const { building, hit } = scene();
  const x = (building.entryX + 0.5) * T;
  for (const row of [0, 3, 6])
    expect(hit(x, (building.lobbyY + row) * T + 8)).toEqual({
      kind: "reception",
      key: building.hostKey,
    });
  expect(hit(x, (building.lobbyY + 3) * T, "room")).toEqual({
    kind: "building",
    key: building.hostKey,
  });
  // The rooms start below the lobby.
  expect(hit(x, (building.lobbyY + 7) * T + 8)?.kind).not.toBe("reception");
});
