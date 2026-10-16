import { packOfficeRoomShapes } from "./officePackingSearch";
import type { OfficeRect, OfficeRoomRect } from "./officeGeometry";

/** The same free-rectangle packer places fixed building footprints and room shapes. */
export function packOfficeRooms(
  sizes: readonly { width: number; height: number }[],
  availableWidth: number,
  horizontalGap: number,
  verticalGap: number,
) {
  return packOfficeRoomShapes(
    sizes.map((size) => [size]),
    availableWidth,
    horizontalGap,
    verticalGap,
    1,
  ).map(({ x, y, width, height }) => ({ x, y, width, height }));
}

/** Lightweight preliminary sizing pass; final rooms/buildings use free rectangles. */
export function packOfficeRoomContour(
  sizes: readonly { width: number; height: number }[],
  availableWidth: number,
  horizontalGap: number,
  verticalGap: number,
) {
  type Span = { x: number; right: number; y: number };
  let skyline: Span[] = [{ x: 0, right: availableWidth, y: 0 }];
  return sizes.map(({ width, height }) => {
    let bestX = 0;
    let bestY = Number.POSITIVE_INFINITY;
    for (let start = 0; start < skyline.length; start++) {
      const x = skyline[start]!.x;
      if (x + width > availableWidth && start > 0) continue;
      let y = 0;
      for (
        let next = start;
        next < skyline.length &&
        skyline[next]!.x < Math.min(availableWidth, x + width + horizontalGap);
        next++
      ) {
        y = Math.max(y, skyline[next]!.y);
      }
      if (y < bestY) {
        bestX = x;
        bestY = y;
      }
    }
    const right = Math.min(availableWidth, bestX + width + horizontalGap);
    const replacement = { x: bestX, right, y: bestY + height + verticalGap };
    const nextSkyline: Span[] = [];
    let inserted = false;
    for (const span of skyline) {
      if (span.right <= bestX || span.x >= right) {
        if (!inserted && span.x >= right) {
          nextSkyline.push(replacement);
          inserted = true;
        }
        nextSkyline.push(span);
        continue;
      }
      if (span.x < bestX) nextSkyline.push({ ...span, right: bestX });
      if (!inserted) {
        nextSkyline.push(replacement);
        inserted = true;
      }
      if (span.right > right) nextSkyline.push({ ...span, x: right });
    }
    if (!inserted) nextSkyline.push(replacement);
    skyline = [];
    for (const span of nextSkyline) {
      const prior = skyline[skyline.length - 1];
      if (prior && prior.y === span.y && prior.right === span.x)
        prior.right = span.right;
      else skyline.push(span);
    }
    return { x: bestX, y: bestY, width, height };
  });
}

/** Corridors belong to each reserved footprint, never to a whole room row. */
export function officePackedRoomCorridors(
  room: OfficeRect,
  rightEdge: number,
  horizontalGap: number,
  verticalGap: number,
) {
  return {
    horizontal: {
      x: room.x,
      y: room.y + room.height,
      width: room.width,
      height: verticalGap,
    },
    vertical: {
      x: room.x + room.width,
      y: room.y,
      width: Math.max(
        0,
        Math.min(horizontalGap, rightEdge - room.x - room.width),
      ),
      height: room.height + verticalGap,
    },
  };
}

/** Preserve the logical desk/standing row when a responsive room changes columns. */
export function officeRoomScrollOffset(
  previous: OfficeRoomRect,
  next: OfficeRoomRect,
  offset: number,
) {
  const contentTop = 56;
  if (offset <= contentTop || previous.collapsed || next.collapsed)
    return offset;
  const contentOffset = offset - contentTop;
  const deskHeight = previous.deskRows * previous.deskRowHeight;
  if (contentOffset < deskHeight) {
    const deskIndex =
      Math.floor(contentOffset / previous.deskRowHeight) * previous.deskColumns;
    return (
      contentTop +
      Math.floor(deskIndex / next.deskColumns) * next.deskRowHeight +
      (contentOffset % previous.deskRowHeight)
    );
  }
  const standingOffset = contentOffset - deskHeight;
  const standingIndex =
    Math.floor(standingOffset / 112) * previous.standingColumns;
  return (
    contentTop +
    next.deskRows * next.deskRowHeight +
    Math.floor(standingIndex / next.standingColumns) * 112 +
    (standingOffset % 112)
  );
}
