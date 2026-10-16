import {
  resolveOfficeLayout,
  OFFICE_GEOMETRY,
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
  const footprints = groups.map((group) => {
    const minimumRooms = group.roomIndices
      .map((index) => Math.min(400, base.rooms[index]!.width))
      .sort((a, b) => a - b);
    const minimum = Math.min(
      available,
      Math.max(
        MIN_BUILDING_WIDTH,
        group.collapsed
          ? 0
          : minimumRooms.slice(0, 2).reduce((sum, width) => sum + width, 48) +
              (minimumRooms.length > 1 ? OFFICE_GEOMETRY.roomGap : 0),
      ),
    );
    const maximum = group.collapsed
      ? minimum
      : Math.max(
          minimum,
          Math.min(
            available,
            group.roomIndices.reduce((sum, index) => {
              const room = input.rooms[index]!;
              const contentWidth = collapsedRooms.has(index)
                ? MIN_BUILDING_WIDTH
                : Math.max(
                    OFFICE_GEOMETRY.minRoomWidth,
                    base.rooms[index]!.width,
                    OFFICE_GEOMETRY.roomPadding * 2 +
                      room.deskCount * OFFICE_GEOMETRY.paneDeskWidth,
                    OFFICE_GEOMETRY.roomPadding * 2 + room.standingCount * 40,
                  );
              return sum + contentWidth + OFFICE_GEOMETRY.roomGap;
            }, 48) - OFFICE_GEOMETRY.roomGap,
          ),
        );
    const area = group.collapsed
      ? minimum * COLLAPSED_BUILDING_HEIGHT
      : Math.max(
          minimum * 240,
          group.roomIndices.reduce((sum, index) => {
            const room = base.rooms[index]!;
            return (
              sum +
              (room.width + OFFICE_GEOMETRY.roomGap) *
                (room.height + OFFICE_GEOMETRY.roomRowGap)
            );
          }, 0),
        );
    return { minimum, maximum, area };
  });
  const widths = base.compact
    ? groups.map(() => available)
    : fluidBuildingWidths(footprints, available);
  const headers = new Map<number, ReturnType<typeof resolveOfficeRoomHeader>>();
  const nested: OfficeRoomRect[][] = [];
  const sizes: { width: number; height: number }[] = [];
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex]!;
    const width = widths[groupIndex]!;
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

/** Allocate useful horizontal space before the skyline chooses independent heights. */
function fluidBuildingWidths(
  items: readonly { minimum: number; maximum: number; area: number }[],
  available: number,
) {
  const widths = items.map((item) => item.minimum);
  let start = 0;
  while (start < items.length) {
    let end = start + 1;
    let used = items[start]!.minimum;
    while (
      end < items.length &&
      used + BUILDING_GAP + items[end]!.minimum <= available
    ) {
      used += BUILDING_GAP + items[end]!.minimum;
      end++;
    }
    let remaining = available - used;
    let flexible = Array.from(
      { length: end - start },
      (_, index) => start + index,
    ).filter((index) => widths[index]! < items[index]!.maximum);
    while (remaining > 0.01 && flexible.length) {
      const weight = flexible.reduce(
        (sum, index) => sum + items[index]!.area,
        0,
      );
      let allocated = 0;
      for (const index of flexible) {
        const extra = Math.min(
          items[index]!.maximum - widths[index]!,
          (remaining * items[index]!.area) / weight,
        );
        widths[index]! += extra;
        allocated += extra;
      }
      remaining -= allocated;
      flexible = flexible.filter(
        (index) => items[index]!.maximum - widths[index]! > 0.01,
      );
      if (allocated < 0.01) break;
    }
    start = end;
  }
  return widths.map((width) => Math.floor(width));
}
