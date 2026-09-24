/*
 * MODIFIED FILE NOTICE — Apache-2.0 Section 4(b)
 *
 * This TypeScript geometry adaptation is downstream Herdr World / Office work
 * derived from the historical Claw-Empire Office geometry. Source provenance,
 * source hashes, and license obligations are recorded in docs/world-assets.md.
 */
export const OFFICE_GEOMETRY = Object.freeze({
  minOfficeWidth: 1000,
  ceoBandHeight: 214,
  ceoEdgePadding: 28,
  ceoDeskWidth: 160,
  ceoBoardWidth: 204,
  ceoOtelBoardWidth: 204,
  ceoBoardY: 48,
  ceoBoardHeight: 154,
  ceoBlockGap: 24,
  ceoCompactBlockGap: 8,
  agentBarMinWidth: 280,
  agentBarPreferredWidth: 560,
  agentBarGap: 28,
  agentBarCounterBottomClearance: 64,
  receptionStationMinWidth: 176,
  receptionTableWidth: 160,
  receptionTableHeight: 42,
  receptionTableNudgeX: -4,
  maxReceptionDesks: 6,
  hallwayHeight: 32,
  characterHeight: 68,
  deskWidth: 48,
  deskHeight: 26,
  roomPadding: 16,
  tile: 20,
  roomGap: 16,
  roomRowGap: 28,
  maxRooms: 128,
  desksPerRoom: 8,
  deskColumns: 4,
  deskRowHeight: 128,
  deskTopOffset: 14,
  standingColumns: 8,
  standingRowHeight: 112,
  minRoomWidth: 220,
  minRoomHeight: 188,
  roomHeaderHeight: 34,
  roomHeaderSafeInset: 8,
  roomHeaderActionWidth: 20,
  roomHeaderActionGap: 8,
  roomHeaderCloseGap: 8,
  roomHeaderChromeWidth: 88,
  roomHeaderChromeHeight: 34,
  overflowMarkerMinWidth: 96,
  overflowMarkerMinHeight: 20,
  overflowMarkerGap: 6,
  shadowAllowance: 4,
  selectionStrokeAllowance: 2,
  maxLogicalCanvasWidth: 4096,
  maxLogicalCanvasHeight: 8192,
  maxExpandedRoomWidth: 2048,
  maxExpandedRoomHeight: 4096,
  maxLayoutRows: 128,
  maxContentItems: 128,
});

export type OfficeRoomPresentation = {
  sourceIndex?: number;
  deskCount: number;
  standingCount: number;
  contentMinWidth?: number;
  headerMinWidth?: number;
  headerMinTitleBoxWidth?: number;
  headerMinHeight?: number;
  preferredWidth?: number;
  preferredHeight?: number;
  maximumWidth?: number;
  maximumHeight?: number;
};

export type OfficeRoomAlignment = "left" | "center" | "right";
export const DEFAULT_OFFICE_ROOM_ALIGNMENT: OfficeRoomAlignment = "left";
export type OfficeLongRoomTitleMode = "expand" | "compact";
export const DEFAULT_OFFICE_LONG_ROOM_TITLE_MODE: OfficeLongRoomTitleMode =
  "expand";

export type OfficeRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OfficeRoomHeaderLayout = {
  workspace: string;
  host: string;
  width: number;
  titleBoxX: number;
  titleBoxWidth: number;
  renameX: number;
  closeX: number;
  renameWidth: number;
  closeWidth: number;
  actionWidth: number;
  actionGap: number;
  closeGap: number;
  height: number;
  emergencyEllipsis: boolean;
};

export type OfficeOverflowMarker = {
  label: string;
  required: boolean;
};

export type OfficeReceptionRect = {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  gapBefore: number;
};

export type OfficeCeoBlockLayout = {
  ceoX: number;
  boardX: number;
  otelBoardX: number;
  blockGap: number;
  receptions: OfficeReceptionRect[];
  ceoOriginX: number;
  ceoScale: number;
  ceoContentWidth: number;
  localCeoX: number;
  localBoardX: number;
  localOtelBoardX: number;
  localBlockGap: number;
  localReceptions: OfficeReceptionRect[];
  agentBarX: number;
  agentBarWidth: number;
  ceoBandHeight: number;
  agentBarHeight: number;
  receptionRows: number;
};

export type OfficeRoomRect = {
  index: number;
  column: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
  deskColumns: number;
  standingColumns: number;
  deskRows: number;
  standingRows: number;
  outerRect: OfficeRect;
  wallRect: OfficeRect;
  headerRect: OfficeRect;
  contentSafeRect: OfficeRect;
  clipRect: OfficeRect;
  inkBounds: OfficeRect;
  shadowAllowance: number;
  selectionStrokeAllowance: number;
  header?: OfficeRoomHeaderLayout;
  overflowMarkerRect?: OfficeRect;
};

export type OfficeLayout = {
  officeWidth: number;
  totalHeight: number;
  columns: number;
  rows: number;
  roomWidth: number;
  roomStartX: number;
  roomStartY: number;
  ceoBandHeight: number;
  ceoRect: OfficeRect;
  ceoContentRect: OfficeRect;
  agentBarRect: OfficeRect;
  ceoBlocks: OfficeCeoBlockLayout;
  fallbackMessage?: string | null;
  rooms: readonly OfficeRoomRect[];
  layoutRevision: number;
  inputDigest?: string;
  overflowMarker?: OfficeOverflowMarker;
  ceoOverflowMarkerRect?: OfficeRect;
};

export function resolveOfficeLayout(
  requestedWidth: number,
  requestedRooms: number | readonly OfficeRoomPresentation[],
  roomAlignment: OfficeRoomAlignment = DEFAULT_OFFICE_ROOM_ALIGNMENT,
  requestedCeoBandHeight: number = OFFICE_GEOMETRY.ceoBandHeight,
  requestedCeoReceptionCount: number = 0,
  requestedMaximumCeoBandHeight: number = Number.POSITIVE_INFINITY,
): OfficeLayout {
  const officeWidth = Math.max(
    OFFICE_GEOMETRY.minOfficeWidth,
    Math.min(
      OFFICE_GEOMETRY.maxLogicalCanvasWidth,
      Math.floor(Number(requestedWidth) || 0),
    ),
  );
  const presentations: OfficeRoomPresentation[] =
    typeof requestedRooms === "number"
      ? Array.from(
          { length: boundedCount(requestedRooms, OFFICE_GEOMETRY.maxRooms) },
          () => ({ deskCount: 0, standingCount: 0 }),
        )
      : requestedRooms
          .slice(0, OFFICE_GEOMETRY.maxRooms)
          .map(
            ({
              sourceIndex,
              deskCount,
              standingCount,
              contentMinWidth,
              headerMinWidth,
              headerMinTitleBoxWidth,
              headerMinHeight,
              preferredWidth,
              preferredHeight,
              maximumWidth,
              maximumHeight,
            }) => ({
              sourceIndex,
              deskCount: boundedCount(deskCount, OFFICE_GEOMETRY.desksPerRoom),
              standingCount: boundedCount(
                standingCount,
                OFFICE_GEOMETRY.standingColumns * 2,
              ),
              contentMinWidth,
              headerMinWidth,
              headerMinTitleBoxWidth,
              headerMinHeight,
              preferredWidth,
              preferredHeight,
              maximumWidth,
              maximumHeight,
            }),
          );
  const count = presentations.length;
  const availableRoomWidth = Math.max(0, officeWidth - 24);
  const requestedReceptionCount = boundedCount(
    requestedCeoReceptionCount,
    OFFICE_GEOMETRY.maxReceptionDesks,
  );
  const ceoHeightCap = Math.min(
    Number.isFinite(requestedMaximumCeoBandHeight)
      ? Math.max(0, Math.floor(requestedMaximumCeoBandHeight))
      : Number.POSITIVE_INFINITY,
    OFFICE_GEOMETRY.maxExpandedRoomHeight,
  );
  const ceoBlocks = resolveCeoBlockLayout(
    officeWidth,
    requestedReceptionCount,
    ceoHeightCap,
  );
  const ceoBandHeight = Math.min(
    ceoHeightCap,
    Math.max(
      OFFICE_GEOMETRY.ceoBandHeight,
      ceoBlocks.ceoBandHeight,
      Math.floor(Number(requestedCeoBandHeight) || 0),
    ),
  );
  const roomStartY = ceoBandHeight + OFFICE_GEOMETRY.hallwayHeight;
  const agentBarX = ceoBlocks.agentBarX;
  const agentBarWidth = ceoBlocks.agentBarWidth;
  const ceoRect = {
    x: 4,
    y: 4,
    width: Math.max(0, agentBarX - OFFICE_GEOMETRY.agentBarGap - 4),
    height: Math.max(0, ceoBandHeight - 4),
  };
  const agentBarRect = {
    x: agentBarX,
    y: 4,
    width: agentBarWidth,
    height: Math.max(0, ceoBandHeight - 4),
  };
  const ceoContentRect = {
    x: ceoRect.x + 8,
    y: ceoRect.y + 40,
    width: Math.max(0, ceoRect.width - 16),
    height: Math.max(0, ceoRect.height - 48),
  };
  const roomMetrics = presentations.map(
    ({
      deskCount,
      standingCount,
      sourceIndex,
      contentMinWidth = 0,
      headerMinWidth = 0,
      headerMinTitleBoxWidth = 0,
      headerMinHeight = OFFICE_GEOMETRY.roomHeaderHeight,
      preferredWidth,
      preferredHeight,
      maximumWidth,
      maximumHeight,
    }) => {
      const deskColumns = roomDeskColumns(deskCount);
      const standingColumns = roomStandingColumns(standingCount);
      const deskRows = Math.ceil(deskCount / deskColumns);
      const standingRows = Math.ceil(standingCount / standingColumns);
      const contentHeight =
        42 +
        deskRows * OFFICE_GEOMETRY.deskRowHeight +
        standingRows * OFFICE_GEOMETRY.standingRowHeight +
        18;
      const intrinsicWidth = Math.max(
        OFFICE_GEOMETRY.minRoomWidth,
        headerMinWidth,
        headerMinTitleBoxWidth,
        contentMinWidth,
        preferredWidth ?? 0,
        OFFICE_GEOMETRY.roomPadding * 2 +
          Math.max(
            deskColumns * 112,
            standingCount > 0 ? standingColumns * 40 : 0,
          ),
      );
      const intrinsicHeight = Math.max(
        OFFICE_GEOMETRY.minRoomHeight,
        headerMinHeight,
        preferredHeight ?? 0,
        contentHeight,
      );
      return {
        deskColumns,
        standingColumns,
        deskRows,
        standingRows,
        height: Math.min(
          maximumHeight ?? Number.POSITIVE_INFINITY,
          intrinsicHeight,
        ),
        headerHeight: Math.max(
          OFFICE_GEOMETRY.roomHeaderHeight,
          headerMinHeight,
        ),
        preferredWidth: Math.min(
          maximumWidth ?? Number.POSITIVE_INFINITY,
          intrinsicWidth,
        ),
        maximumWidth,
        maximumHeight,
        sourceIndex,
      };
    },
  );
  const packedRows: number[][] = [];
  let currentRow: number[] = [];
  let currentWidth = 0;
  roomMetrics.forEach(({ preferredWidth }, index) => {
    const nextWidth =
      currentRow.length > 0
        ? currentWidth + OFFICE_GEOMETRY.roomGap + preferredWidth
        : preferredWidth;
    if (currentRow.length > 0 && nextWidth > availableRoomWidth) {
      packedRows.push(currentRow);
      currentRow = [];
      currentWidth = 0;
    }
    currentRow.push(index);
    currentWidth =
      currentRow.length > 1
        ? currentWidth + OFFICE_GEOMETRY.roomGap + preferredWidth
        : preferredWidth;
  });
  if (currentRow.length > 0) {
    packedRows.push(currentRow);
  }
  const columns = Math.max(1, ...packedRows.map((row) => row.length));
  const rows = packedRows.length;
  const rowHeights = Array.from({ length: rows }, (_, row) =>
    Math.max(...packedRows[row].map((index) => roomMetrics[index].height)),
  );
  const rowYs: number[] = [];
  let nextY = roomStartY;
  for (const height of rowHeights) {
    rowYs.push(nextY);
    nextY += height + OFFICE_GEOMETRY.roomRowGap;
  }
  const roomPositions = new Map<number, OfficeRoomRect>();
  packedRows.forEach((row, rowIndex) => {
    const widths = row.map((index) => roomMetrics[index].preferredWidth);
    const rowWidth =
      widths.reduce((sum, width) => sum + width, 0) +
      OFFICE_GEOMETRY.roomGap * Math.max(0, row.length - 1);
    let x =
      roomAlignment === "left"
        ? 12
        : roomAlignment === "right"
          ? officeWidth - 12 - rowWidth
          : (officeWidth - rowWidth) / 2;
    row.forEach((index, column) => {
      const metric = roomMetrics[index];
      const outerRect = {
        x,
        y: rowYs[rowIndex],
        width: metric.preferredWidth,
        height: Math.min(
          metric.maximumHeight ?? Number.POSITIVE_INFINITY,
          metric.height,
        ),
      };
      const wallRect = insetRect(outerRect, 2);
      const headerRect = {
        x: outerRect.x + OFFICE_GEOMETRY.roomHeaderSafeInset,
        y: outerRect.y + OFFICE_GEOMETRY.roomHeaderSafeInset,
        width: Math.max(
          0,
          outerRect.width - OFFICE_GEOMETRY.roomHeaderSafeInset * 2,
        ),
        height: Math.min(
          metric.headerHeight,
          Math.max(
            0,
            outerRect.height - OFFICE_GEOMETRY.roomHeaderSafeInset * 2,
          ),
        ),
      };
      const contentSafeRect = {
        x: outerRect.x + OFFICE_GEOMETRY.roomPadding,
        y:
          outerRect.y +
          OFFICE_GEOMETRY.roomHeaderHeight +
          OFFICE_GEOMETRY.roomPadding,
        width: Math.max(0, outerRect.width - OFFICE_GEOMETRY.roomPadding * 2),
        height: Math.max(
          0,
          outerRect.height -
            OFFICE_GEOMETRY.roomHeaderHeight -
            OFFICE_GEOMETRY.roomPadding * 2,
        ),
      };
      const clipRect = insetRect(
        outerRect,
        OFFICE_GEOMETRY.selectionStrokeAllowance,
      );
      const inkBounds = insetRect(
        outerRect,
        Math.max(
          OFFICE_GEOMETRY.shadowAllowance,
          OFFICE_GEOMETRY.selectionStrokeAllowance,
        ),
      );
      roomPositions.set(metric.sourceIndex ?? index, {
        index: metric.sourceIndex ?? index,
        column,
        row: rowIndex,
        ...outerRect,
        deskColumns: metric.deskColumns,
        standingColumns: metric.standingColumns,
        deskRows: metric.deskRows,
        standingRows: metric.standingRows,
        outerRect,
        wallRect,
        headerRect,
        contentSafeRect,
        clipRect,
        inkBounds,
        shadowAllowance: OFFICE_GEOMETRY.shadowAllowance,
        selectionStrokeAllowance: OFFICE_GEOMETRY.selectionStrokeAllowance,
      });
      x += metric.preferredWidth + OFFICE_GEOMETRY.roomGap;
    });
  });
  const rooms = [...roomPositions.values()].sort(
    (left, right) => left.index - right.index,
  );
  const roomWidth = Math.max(0, ...rooms.map(({ width }) => width));
  const roomStartX =
    rooms.length > 0 ? Math.min(...rooms.map(({ x }) => x)) : 0;
  const totalHeight = nextY + 30 + (count < OFFICE_GEOMETRY.maxRooms ? 64 : 0);
  return {
    officeWidth,
    totalHeight,
    columns,
    rows,
    roomWidth,
    roomStartX,
    roomStartY,
    ceoBandHeight,
    ceoRect,
    ceoContentRect,
    agentBarRect,
    ceoBlocks: {
      ...ceoBlocks,
      ceoBandHeight,
      agentBarHeight: Math.max(0, ceoBandHeight - 4),
    },
    rooms,
    layoutRevision: 0,
  };
}

function insetRect(rect: OfficeRect, inset: number): OfficeRect {
  const safeInset = Math.max(0, Math.floor(Number(inset) || 0));
  return {
    x: rect.x + safeInset,
    y: rect.y + safeInset,
    width: Math.max(0, rect.width - safeInset * 2),
    height: Math.max(0, rect.height - safeInset * 2),
  };
}

export function minimumOfficeWidthForReceptions(receptionCount: number) {
  const count = boundedCount(receptionCount, OFFICE_GEOMETRY.maxReceptionDesks);
  const ceoContentWidth = intrinsicCeoContentWidth(count);
  return Math.max(
    OFFICE_GEOMETRY.minOfficeWidth,
    OFFICE_GEOMETRY.ceoEdgePadding * 2 +
      ceoContentWidth +
      OFFICE_GEOMETRY.agentBarGap +
      OFFICE_GEOMETRY.agentBarMinWidth,
  );
}

export function agentBarWidthForOffice(
  officeWidth: number,
  receptionCount = 0,
) {
  const ceoContentWidth = intrinsicCeoContentWidth(receptionCount);
  const availableWidth = Math.floor(
    officeWidth -
      OFFICE_GEOMETRY.ceoEdgePadding * 2 -
      ceoContentWidth -
      OFFICE_GEOMETRY.agentBarGap,
  );
  return Math.max(
    OFFICE_GEOMETRY.agentBarMinWidth,
    Math.min(
      OFFICE_GEOMETRY.agentBarPreferredWidth,
      Math.max(OFFICE_GEOMETRY.agentBarMinWidth, availableWidth),
    ),
  );
}

export function agentBarSlot(blocks: OfficeCeoBlockLayout, index: number) {
  const boardWidth = Math.min(76, blocks.agentBarWidth * 0.25);
  const barX = blocks.agentBarX + 10 + boardWidth + 10;
  const barWidth = Math.max(
    0,
    blocks.agentBarX + blocks.agentBarWidth - 10 - barX,
  );
  const counterY =
    4 +
    blocks.ceoBandHeight -
    4 -
    OFFICE_GEOMETRY.agentBarCounterBottomClearance;
  const agentAreaY = 4 + 61;
  const agentAreaHeight = Math.max(1, counterY - agentAreaY - 4);
  const columns = Math.max(3, Math.floor(barWidth / 56));
  const rows = Math.max(2, Math.floor(agentAreaHeight / 56));
  const rowHeight = agentAreaHeight / rows;
  const safeIndex = Math.max(0, Math.floor(index));
  const column = safeIndex % columns;
  const row = Math.min(rows - 1, Math.floor(safeIndex / columns));
  const rowY = agentAreaY + (rows - 1 - row) * rowHeight;
  return {
    x: barX + (barWidth / columns) * (column + 0.5),
    rowY,
    rowHeight,
    characterFeetY: rowY + rowHeight - 2,
    columns,
    capacity: columns * rows,
  };
}

export function resolveCeoBlockLayout(
  officeWidth: number,
  receptionCount: number,
  maximumHeight: number = Number.POSITIVE_INFINITY,
): OfficeCeoBlockLayout {
  const count = boundedCount(receptionCount, OFFICE_GEOMETRY.maxReceptionDesks);
  const coreWidth =
    OFFICE_GEOMETRY.ceoDeskWidth +
    OFFICE_GEOMETRY.ceoBoardWidth +
    OFFICE_GEOMETRY.ceoOtelBoardWidth;
  const agentBarWidth = agentBarWidthForOffice(officeWidth, count);
  const ceoOriginX = OFFICE_GEOMETRY.ceoEdgePadding;
  const ceoContentWidth = Math.max(
    coreWidth + OFFICE_GEOMETRY.ceoCompactBlockGap * 2,
    officeWidth -
      OFFICE_GEOMETRY.ceoEdgePadding * 2 -
      agentBarWidth -
      OFFICE_GEOMETRY.agentBarGap,
  );
  const agentBarX = ceoOriginX + ceoContentWidth + OFFICE_GEOMETRY.agentBarGap;
  const ceoScale = 1;
  const inlineBlockGap = Math.max(
    OFFICE_GEOMETRY.ceoCompactBlockGap,
    (ceoContentWidth -
      (coreWidth + count * OFFICE_GEOMETRY.receptionStationMinWidth)) /
      Math.max(1, count + 2),
  );
  const inlineReceptionStartX = coreWidth + inlineBlockGap;
  const inlineReceptionWidth = Math.max(
    0,
    ceoContentWidth - inlineReceptionStartX,
  );
  const inlineFits =
    count === 0 ||
    inlineReceptionWidth >=
      count * OFFICE_GEOMETRY.receptionStationMinWidth +
        Math.max(0, count - 1) * inlineBlockGap;
  const blockGap = inlineFits
    ? inlineBlockGap
    : OFFICE_GEOMETRY.ceoCompactBlockGap;
  const localCeoX = 0;
  const localOtelBoardX = localCeoX + OFFICE_GEOMETRY.ceoDeskWidth + blockGap;
  const localBoardX =
    localOtelBoardX + OFFICE_GEOMETRY.ceoOtelBoardWidth + blockGap;
  const receptionStartX =
    localBoardX + OFFICE_GEOMETRY.ceoBoardWidth + blockGap;
  const receptionRowY = 190;
  const receptionColumns = inlineFits
    ? count
    : Math.max(
        1,
        Math.min(
          count,
          Math.floor(
            (ceoContentWidth + blockGap) /
              (OFFICE_GEOMETRY.receptionStationMinWidth + blockGap),
          ),
        ),
      );
  const receptionWidth = inlineFits
    ? Math.min(
        OFFICE_GEOMETRY.receptionStationMinWidth,
        Math.max(
          0,
          (inlineReceptionWidth - blockGap * Math.max(0, count - 1)) /
            Math.max(1, count),
        ),
      )
    : Math.min(
        OFFICE_GEOMETRY.receptionStationMinWidth,
        Math.max(
          0,
          (ceoContentWidth - blockGap * Math.max(0, receptionColumns - 1)) /
            Math.max(1, receptionColumns),
        ),
      );
  const localReceptions = Array.from({ length: count }, (_, index) => {
    const row = inlineFits ? 0 : Math.floor(index / receptionColumns);
    const column = inlineFits ? index : index % receptionColumns;
    return {
      index,
      x: inlineFits
        ? receptionStartX + column * (receptionWidth + blockGap)
        : column * (receptionWidth + blockGap),
      y: inlineFits
        ? 36
        : receptionRowY + row * (160 + OFFICE_GEOMETRY.roomRowGap),
      width: receptionWidth,
      height: 160,
      gapBefore: blockGap,
    };
  });
  const heightCap = Number.isFinite(maximumHeight)
    ? Math.max(0, Math.floor(maximumHeight))
    : Number.POSITIVE_INFINITY;
  const visibleLocalReceptions = localReceptions.filter(
    (reception) => reception.y + reception.height <= heightCap,
  );
  const receptionBottom = visibleLocalReceptions.reduce(
    (bottom, reception) => Math.max(bottom, reception.y + reception.height),
    0,
  );
  const ceoBandHeight = Math.min(
    heightCap,
    Math.max(
      OFFICE_GEOMETRY.ceoBandHeight,
      receptionBottom > OFFICE_GEOMETRY.ceoBandHeight - 8
        ? receptionBottom + 8
        : OFFICE_GEOMETRY.ceoBandHeight,
    ),
  );
  const scaleX = (value: number) => ceoOriginX + value * ceoScale;
  const receptions = visibleLocalReceptions.map((reception) => ({
    ...reception,
    x: scaleX(reception.x),
    width: reception.width * ceoScale,
    gapBefore: reception.gapBefore * ceoScale,
  }));
  return {
    ceoX: scaleX(localCeoX),
    boardX: scaleX(localBoardX),
    otelBoardX: scaleX(localOtelBoardX),
    blockGap: blockGap * ceoScale,
    receptions,
    ceoOriginX,
    ceoScale,
    ceoContentWidth,
    localCeoX,
    localBoardX,
    localOtelBoardX,
    localBlockGap: blockGap,
    localReceptions: visibleLocalReceptions,
    agentBarX,
    agentBarWidth,
    ceoBandHeight,
    agentBarHeight: Math.max(0, ceoBandHeight - 4),
    receptionRows:
      visibleLocalReceptions.length === 0
        ? 0
        : new Set(visibleLocalReceptions.map((reception) => reception.y)).size,
  };
}

function intrinsicCeoContentWidth(receptionCount: number) {
  return intrinsicCeoContentWidthForCount(
    boundedCount(receptionCount, OFFICE_GEOMETRY.maxReceptionDesks),
  );
}

function intrinsicCeoContentWidthForCount(count: number) {
  const fixedWidth =
    OFFICE_GEOMETRY.ceoDeskWidth +
    OFFICE_GEOMETRY.ceoBoardWidth +
    OFFICE_GEOMETRY.ceoOtelBoardWidth +
    count * OFFICE_GEOMETRY.receptionStationMinWidth;
  return fixedWidth + (count + 2) * OFFICE_GEOMETRY.ceoCompactBlockGap;
}

export function resolveReceptionLayout(
  officeWidth: number,
  receptionCount: number,
): OfficeReceptionRect[] {
  return resolveCeoBlockLayout(officeWidth, receptionCount).receptions;
}

export function receptionAgentAnchor(
  reception: OfficeReceptionRect,
  agentIndex: number,
) {
  const index = boundedCount(agentIndex, 3);
  const stationSpan = reception.width / 4;
  return {
    index,
    stationSpan,
    x: reception.x + stationSpan * (index + 0.5),
    nameY: reception.y + 35,
    characterFeetY: reception.y + 112,
  };
}

export function receptionTableRect(reception: OfficeReceptionRect) {
  const width = Math.min(
    OFFICE_GEOMETRY.receptionTableWidth,
    Math.max(0, reception.width - 8),
  );
  return {
    x:
      reception.x +
      (reception.width - width) / 2 +
      OFFICE_GEOMETRY.receptionTableNudgeX,
    y: reception.y + 96,
    width,
    height: OFFICE_GEOMETRY.receptionTableHeight,
  };
}

export function deskAnchor(room: OfficeRoomRect, deskIndex: number) {
  const index = boundedCount(deskIndex, OFFICE_GEOMETRY.desksPerRoom - 1);
  const column = index % room.deskColumns;
  const row = Math.floor(index / room.deskColumns);
  const innerWidth = room.width - OFFICE_GEOMETRY.roomPadding * 2;
  const stationSpan = innerWidth / room.deskColumns;
  const x = room.x + OFFICE_GEOMETRY.roomPadding + stationSpan * (column + 0.5);
  const nameY =
    room.y +
    42 +
    OFFICE_GEOMETRY.deskTopOffset +
    row * OFFICE_GEOMETRY.deskRowHeight;
  const characterFeetY = nameY + 37 + OFFICE_GEOMETRY.characterHeight;
  return {
    index,
    column,
    row,
    stationSpan,
    x,
    nameY,
    characterFeetY,
    deskY: characterFeetY - 20,
  };
}

export function standingAnchor(room: OfficeRoomRect, standingIndex: number) {
  const index = boundedCount(standingIndex, room.standingColumns * 2 - 1);
  const column = index % room.standingColumns;
  const row = Math.floor(index / room.standingColumns);
  const innerWidth = room.width - OFFICE_GEOMETRY.roomPadding * 2;
  const stationSpan = innerWidth / room.standingColumns;
  const x = room.x + OFFICE_GEOMETRY.roomPadding + stationSpan * (column + 0.5);
  const nameY =
    room.y +
    42 +
    OFFICE_GEOMETRY.deskTopOffset +
    room.deskRows * OFFICE_GEOMETRY.deskRowHeight +
    row * OFFICE_GEOMETRY.standingRowHeight;
  return {
    index,
    column,
    row,
    stationSpan,
    x,
    nameY,
    characterFeetY: nameY + 96,
  };
}

function boundedCount(value: number, maximum: number) {
  return Math.max(0, Math.min(maximum, Math.floor(Number(value) || 0)));
}

function roomDeskColumns(deskCount: number) {
  if (deskCount <= 2) {
    return 2;
  }
  return Math.min(OFFICE_GEOMETRY.deskColumns, Math.ceil(deskCount / 2));
}

function roomStandingColumns(standingCount: number) {
  return standingCount > 0
    ? Math.min(OFFICE_GEOMETRY.standingColumns, Math.max(4, standingCount))
    : OFFICE_GEOMETRY.standingColumns;
}
