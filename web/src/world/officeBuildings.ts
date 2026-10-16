import {
  resolveOfficeLayout,
  type OfficeBuildingInput,
  type OfficeLayout,
  type OfficeRect,
  type OfficeRoomRect,
} from "./officeGeometry";
import {
  resolveOfficeRoomHeader,
  type OfficeGeometryInput,
  type NormalizedOfficeGeometryInput,
} from "./officeLayout";
import { packOfficeRooms } from "./officeRoomPacking";

const BUILDING_GAP = 20;
const BUILDING_PADDING = 12;
const BUILDING_HEADER = 84;
const COLLAPSED_BUILDING_HEIGHT = BUILDING_HEADER + 16;
const MIN_BUILDING_WIDTH = 360;

/** The same skyline packs room footprints inside hosts, then host footprints. */
export function* resolveOfficeBuildingsSteps(
  base: OfficeLayout,
  input: OfficeGeometryInput,
  normalized: NormalizedOfficeGeometryInput,
  groups: readonly OfficeBuildingInput[],
  collapsedRooms: ReadonlySet<number>,
) {
  const available = base.officeWidth - 24;
  const areas = groups.map((group) =>
    group.collapsed
      ? MIN_BUILDING_WIDTH * COLLAPSED_BUILDING_HEIGHT
      : Math.max(
          MIN_BUILDING_WIDTH * 240,
          group.roomIndices.reduce((sum, index) => {
            const room = base.rooms[index]!;
            return sum + (room.width + 16) * (room.height + 28);
          }, 0),
        ),
  );
  const totalArea = areas.reduce((sum, area) => sum + area, 0);
  const targetHeight = Math.max(
    totalArea /
      Math.max(
        MIN_BUILDING_WIDTH,
        available -
          BUILDING_GAP *
            Math.min(
              groups.length - 1,
              Math.floor(available / MIN_BUILDING_WIDTH) - 1,
            ),
      ),
    Math.sqrt(totalArea / 1.5),
  );
  const headers = new Map<number, ReturnType<typeof resolveOfficeRoomHeader>>();
  const nested: OfficeRoomRect[][] = [];
  const sizes: { width: number; height: number }[] = [];
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex]!;
    const width = base.compact
      ? available
      : Math.min(
          available,
          Math.max(
            MIN_BUILDING_WIDTH,
            Math.min(
              areas[groupIndex]! / targetHeight,
              available -
                (groups.length > 1 ? MIN_BUILDING_WIDTH + BUILDING_GAP : 0),
            ),
          ),
        );
    const innerWidth = width - BUILDING_PADDING * 2;
    const descriptors = group.roomIndices.map((index) => {
      const room = input.rooms[index]!;
      const header = resolveOfficeRoomHeader(room, {
        ...normalized,
        maximumExpandedRoomWidth: innerWidth - 24,
      });
      headers.set(index, header);
      return {
        ...room,
        sourceIndex: index,
        headerMinWidth: header.width,
        headerMinTitleBoxWidth: header.titleBoxWidth,
      };
    });
    const inner = resolveOfficeLayout(
      innerWidth,
      descriptors,
      "left",
      undefined,
      0,
      undefined,
      {
        complete: true,
        compact: base.compact,
        contained: true,
        collapsedRooms,
      },
    );
    nested.push(
      inner.rooms.map((room) => translateRoom(room, 0, -inner.roomStartY)),
    );
    sizes.push({
      width,
      height: group.collapsed
        ? COLLAPSED_BUILDING_HEIGHT
        : BUILDING_HEADER +
          BUILDING_PADDING * 2 +
          Math.max(
            0,
            ...inner.rooms.map(
              (room) => room.y + room.height - inner.roomStartY,
            ),
          ),
    });
    yield;
  }
  const placements = base.compact
    ? sizes.map((size, index) => ({
        ...size,
        x: 0,
        y: sizes
          .slice(0, index)
          .reduce((sum, prior) => sum + prior.height + BUILDING_GAP, 0),
      }))
    : packOfficeRooms(sizes, available, BUILDING_GAP, BUILDING_GAP);
  const usedWidth = Math.max(
    0,
    ...placements.map((rect) => rect.x + rect.width),
  );
  const offset =
    base.compact || input.roomAlignment === "left"
      ? 0
      : (available - usedWidth) / (input.roomAlignment === "right" ? 1 : 2);
  const rooms = new Map<number, OfficeRoomRect>();
  const buildings = groups.map((group, index) => {
    const placement = placements[index]!;
    const rect = {
      ...placement,
      x: placement.x + 12 + offset,
      y: placement.y + base.roomStartY,
    };
    for (const room of nested[index]!) {
      const translated = translateRoom(
        room,
        rect.x + BUILDING_PADDING,
        rect.y + BUILDING_HEADER + BUILDING_PADDING,
      );
      rooms.set(
        room.index,
        group.collapsed
          ? {
              ...translated,
              hiddenByHost: true,
              width: 0,
              height: 0,
              outerRect: { ...translated.outerRect, width: 0, height: 0 },
            }
          : translated,
      );
    }
    return {
      ...group,
      rect,
      headerRect: {
        x: rect.x + 12,
        y: rect.y + 24,
        width: rect.width - 24,
        height: 48,
      },
    };
  });
  const result: OfficeLayout = {
    ...base,
    buildings,
    rooms: [...rooms.values()].sort((a, b) => a.index - b.index),
    totalHeight:
      base.roomStartY +
      Math.max(0, ...placements.map((rect) => rect.y + rect.height)) +
      112,
  };
  return { layout: result, headers };
}

function translateRoom(
  room: OfficeRoomRect,
  x: number,
  y: number,
): OfficeRoomRect {
  const move = (rect: OfficeRect) => ({
    ...rect,
    x: rect.x + x,
    y: rect.y + y,
  });
  return {
    ...room,
    x: room.x + x,
    y: room.y + y,
    outerRect: move(room.outerRect),
    wallRect: move(room.wallRect),
    headerRect: move(room.headerRect),
    contentSafeRect: move(room.contentSafeRect),
    clipRect: move(room.clipRect),
    inkBounds: move(room.inkBounds),
  };
}
