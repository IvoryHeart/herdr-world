import { resolveOfficeLayout } from "./officeGeometry";
import {
  normalizeOfficeGeometryInput,
  officeGeometryDigest,
  resolveOfficeGeometry,
  resolveOfficeRoomHeader,
  type OfficeGeometryInput,
  type OfficeGeometryResult,
} from "./officeLayout";

/** Logical scene extent is independent of the viewport-sized Pixi backing. */
export function resolveOfficeSceneGeometry(
  input: OfficeGeometryInput & {
    attentionReceptionIndices?: readonly number[];
  },
  collapsedRooms: ReadonlySet<number> = new Set(),
): OfficeGeometryResult {
  const compact = input.availableViewportWidth <= 720;
  if (
    !compact &&
    !collapsedRooms.size &&
    input.rooms.length <= 128 &&
    (input.ceoReceptionCount ?? 0) <= 6 &&
    input.rooms.every((room) => room.deskCount <= 8 && room.standingCount <= 16)
  ) {
    const ordinary = resolveOfficeGeometry(input);
    if (!ordinary.omissions.length) return ordinary;
  }
  const normalized = normalizeOfficeGeometryInput({ ...input, rooms: [] });
  const headerInput = {
    ...normalized,
    maximumExpandedRoomWidth: compact
      ? input.availableViewportWidth - 24
      : normalized.maximumExpandedRoomWidth,
  };
  const headers = input.rooms.map((room) =>
    resolveOfficeRoomHeader(room, headerInput),
  );
  const layout = resolveOfficeLayout(
    input.availableViewportWidth,
    input.rooms.map((room, sourceIndex) => ({
      ...room,
      sourceIndex,
      headerMinWidth: headers[sourceIndex]!.width,
      headerMinTitleBoxWidth: headers[sourceIndex]!.titleBoxWidth,
    })),
    input.roomAlignment,
    undefined,
    input.ceoReceptionCount,
    undefined,
    {
      complete: true,
      compact,
      collapsedRooms,
      attentionReceptionIndices: input.attentionReceptionIndices,
    },
  );
  const rooms = layout.rooms.map((room) => {
    const header = headers[room.index]!;
    const titleBoxX = Math.max(
      0,
      (room.headerRect.width - header.titleBoxWidth) / 2,
    );
    return {
      ...room,
      header: {
        ...header,
        titleBoxX,
        renameX: titleBoxX + header.titleBoxWidth + header.actionGap,
        closeX: room.headerRect.width - header.closeWidth,
      },
    };
  });
  // Canonical inputs contain geometry/identity only, never live runtime handles.
  const inputDigest = officeGeometryDigest(
    JSON.stringify([input, [...collapsedRooms].sort((a, b) => a - b), compact]),
  );
  return {
    inputDigest,
    normalizedInput: {
      ...normalized,
      rooms: input.rooms.map((room, sourceIndex) => ({
        ...room,
        sourceIndex,
        contentItems: [],
        contentItemCount: 0,
      })),
      ceoReceptionCount: input.ceoReceptionCount ?? 0,
      maximumExpandedCanvasHeight: layout.totalHeight,
      maxLayoutRows: layout.rows,
    },
    layout: { ...layout, rooms, inputDigest },
    roomHeaders: rooms.map((room) => room.header),
    rows: rooms.map((room) => ({
      roomIndex: room.index,
      index: room.row,
      rect: room.outerRect,
    })),
    contentItems: [],
    omissions: [],
    omissionSummary: {
      total: 0,
      byReason: {},
      byImportance: {},
      samples: {},
      samplesByImportance: {},
    },
    normalizationErrors: [],
    fallbackMessage: null,
    accessibleOverflow: null,
    resolvedCanvasWidth: Math.min(
      layout.officeWidth,
      input.availableViewportWidth,
    ),
    resolvedCanvasHeight: Math.min(
      layout.totalHeight,
      input.availableViewportHeight ?? layout.totalHeight,
    ),
  };
}
