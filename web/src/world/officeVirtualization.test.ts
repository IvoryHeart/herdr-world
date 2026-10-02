import { expect, test } from "bun:test";
import { officeVisibleRooms } from "./officeVirtualization";
import type { OfficeRoomRect } from "./officeGeometry";

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
