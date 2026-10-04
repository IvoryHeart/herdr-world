import { expect, test } from "bun:test";
import {
  officeVisibleReceptions,
  officeVisibleRooms,
} from "./officeVirtualization";
import type { OfficeRoomRect } from "./officeGeometry";
import type { OfficeReceptionRect } from "./officeGeometry";
import type { OfficeReception } from "./herdrOfficeProjection";

test("a distant tall room cannot expand paint admission beyond the adjacent viewport", () => {
  const rooms = [0, 600, 1200, 1800, 50000].map(
    (y, index) =>
      ({ index, y, height: index === 4 ? 30000 : 500 }) as OfficeRoomRect,
  );
  expect(officeVisibleRooms(rooms, 0, 600).map((room) => room.index)).toEqual([
    0, 1, 2,
  ]);
  expect(
    officeVisibleRooms(rooms, 1800, 600).map((room) => room.index),
  ).toEqual([2, 3]);
  expect(
    officeVisibleRooms(rooms, 50000, 600).map((room) => room.index),
  ).toEqual([4]);
  expect(rooms).toHaveLength(5);
});

test("reception paint admission follows the horizontal viewport and keeps source indices", () => {
  const receptions = Array.from(
    { length: 64 },
    (_, index) =>
      ({
        key: `reception-${index}`,
        hostKey: `host-${index}`,
        hostLabel: `Host ${index}`,
        stale: false,
        waitingAgents: [],
        observedWaitingAgentCount: 0,
        overflowCount: 0,
      }) satisfies OfficeReception,
  );
  const rects = receptions.map(
    (_, index) =>
      ({
        index,
        x: index * 240,
        y: 0,
        width: 220,
        height: 180,
        gapBefore: 0,
      }) satisfies OfficeReceptionRect,
  );

  const visible = officeVisibleReceptions(receptions, rects, 2_400, 800);

  expect(visible.map(({ index }) => index)).toEqual([
    6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
  ]);
  expect(
    visible.map(({ reception, rect }) => [reception.key, rect.index]),
  ).toEqual(visible.map(({ index }) => [`reception-${index}`, index]));
  expect(receptions).toHaveLength(64);
});
