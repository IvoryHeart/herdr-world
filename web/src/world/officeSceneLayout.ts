import { resolveOfficeBuildingsSteps } from "./officeBuildings";
import type { OfficeBuildingInput } from "./officeGeometry";
import { resolveOfficeLayoutSteps } from "./officeGeometry";
import {
  normalizeOfficeGeometryInput,
  officeGeometryDigest,
  resolveOfficeRoomHeader,
  type OfficeGeometryInput,
  type OfficeGeometryResult,
} from "./officeLayout";

/** Logical scene extent is independent of the viewport-sized Pixi backing. */
export type OfficeSceneInput = OfficeGeometryInput & {
  attentionReceptionIndices?: readonly number[];
  buildings?: readonly OfficeBuildingInput[];
};

export function resolveOfficeSceneGeometry(
  input: OfficeSceneInput,
  collapsedRooms: ReadonlySet<number> = new Set(),
): OfficeGeometryResult {
  const steps = resolveOfficeSceneGeometrySteps(input, collapsedRooms);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export async function resolveOfficeSceneGeometryAsync(
  input: OfficeSceneInput,
  collapsedRooms: ReadonlySet<number>,
  isCurrent: () => boolean,
  yieldTask: () => Promise<void>,
): Promise<OfficeGeometryResult | null> {
  const steps = resolveOfficeSceneGeometrySteps(input, collapsedRooms);
  let next = steps.next();
  while (!next.done) {
    await yieldTask();
    if (!isCurrent()) {
      steps.return(null as never);
      return null;
    }
    next = steps.next();
  }
  return isCurrent() ? next.value : null;
}

function* resolveOfficeSceneGeometrySteps(
  input: OfficeSceneInput,
  collapsedRooms: ReadonlySet<number>,
): Generator<void, OfficeGeometryResult> {
  const compact = input.availableViewportWidth <= 720;
  const normalized = normalizeOfficeGeometryInput({ ...input, rooms: [] });
  const headerInput = {
    ...normalized,
    maximumExpandedRoomWidth: compact
      ? input.availableViewportWidth - 24
      : normalized.maximumExpandedRoomWidth,
  };
  let headers = input.rooms.map((room) =>
    resolveOfficeRoomHeader(room, headerInput),
  );
  let layout = yield* resolveOfficeLayoutSteps(
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
      shapeSearch: !input.buildings?.length,
      compact,
      collapsedRooms,
      attentionReceptionIndices: input.attentionReceptionIndices,
    },
  );
  if (input.buildings?.length) {
    const grouped = yield* resolveOfficeBuildingsSteps(
      layout,
      input,
      normalized,
      input.buildings,
      collapsedRooms,
    );
    layout = grouped.layout;
    headers = headers.map(
      (header, index) => grouped.headers.get(index) ?? header,
    );
  }
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
