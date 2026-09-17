import {
  OFFICE_GEOMETRY,
  resolveCeoBlockLayout,
  resolveOfficeLayout,
} from "./officeGeometry";
import type {
  OfficeLayout,
  OfficeLongRoomTitleMode,
  OfficeOverflowMarker,
  OfficeRect,
  OfficeRoomAlignment,
  OfficeRoomHeaderLayout,
  OfficeRoomPresentation,
  OfficeRoomRect,
} from "./officeGeometry";

const MAX_OMISSION_SAMPLES = 8;
const DEFAULT_MAX_CONTENT_ITEMS = OFFICE_GEOMETRY.maxContentItems;

export type OfficeContentImportance = "required" | "preferred" | "optional";
export type OfficeContentFlow = "row" | "column" | "wrap-row" | "grid";
export type OfficeContentSpanPolicy = "single" | "multi-row" | "remaining";

export type OfficeContentItemDescriptor = {
  id: string;
  kind: string;
  importance: OfficeContentImportance;
  order: number;
  priority?: number;
  minWidth: number;
  minHeight: number;
  preferredWidth?: number;
  preferredHeight?: number;
};

type OfficeContentItemLike = OfficeContentItemDescriptor & {
  valid?: boolean;
};

export type OfficeGeometryRoomDescriptor = OfficeRoomPresentation & {
  id: string;
  role?: "ceo" | "work" | "agent-bar" | string;
  precedence?: number;
  region?: "ceo" | "agent-bar" | "work";
  order?: number;
  flow?: OfficeContentFlow;
  spanPolicy?: OfficeContentSpanPolicy;
  contentMinWidth?: number;
  title?: string;
  hostTitle?: string;
  /** Presentation-supplied labels after exact canvas-font measurement. */
  visualTitle?: string;
  visualHostTitle?: string;
  actions?: {
    rename: boolean;
    close: boolean;
    createSeat: boolean;
  };
  contentItems?: readonly OfficeContentItemDescriptor[];
};

export type OfficeGeometryStyleTokens = {
  fixedHeaderChromeWidth?: number;
  fixedHeaderChromeHeight?: number;
  overflowMarkerMinWidth?: number;
  overflowMarkerMinHeight?: number;
  overflowMarkerGap?: number;
  roomSafeInset?: number;
};

export type OfficeGeometryInput = {
  availableViewportWidth: number;
  availableViewportHeight?: number;
  minimumLogicalCanvasWidth?: number;
  minimumLogicalCanvasHeight?: number;
  maximumExpandedCanvasWidth?: number;
  maximumExpandedCanvasHeight?: number;
  maximumExpandedRoomWidth?: number;
  maximumExpandedRoomHeight?: number;
  maxContentItems?: number;
  maxLayoutRows?: number;
  overflowMode?: "logical-scroll";
  fontKey?: string;
  fontReady?: boolean;
  titleMode: OfficeLongRoomTitleMode;
  roomAlignment: OfficeRoomAlignment;
  ceoReceptionCount?: number;
  ceoContentItems?: readonly OfficeContentItemDescriptor[];
  rooms: readonly OfficeGeometryRoomDescriptor[];
  style?: OfficeGeometryStyleTokens;
};

export type NormalizedOfficeGeometryInput = {
  availableViewportWidth: number;
  availableViewportHeight: number;
  minimumLogicalCanvasWidth: number;
  minimumLogicalCanvasHeight: number;
  minimumRoomWidth: number;
  minimumRoomHeight: number;
  maximumExpandedCanvasWidth: number;
  maximumExpandedCanvasHeight: number;
  maximumExpandedRoomWidth: number;
  maximumExpandedRoomHeight: number;
  maxContentItems: number;
  maxLayoutRows: number;
  overflowMode: "logical-scroll";
  fontKey: string;
  fontReady: boolean;
  titleMode: OfficeLongRoomTitleMode;
  roomAlignment: OfficeRoomAlignment;
  ceoReceptionCount: number;
  ceoContentItems: readonly NormalizedOfficeContentItemDescriptor[];
  ceoContentItemCount: number;
  styleCapacityInvalid: boolean;
  style: Required<OfficeGeometryStyleTokens>;
  rooms: readonly NormalizedOfficeGeometryRoomDescriptor[];
};

export type NormalizedOfficeContentItemDescriptor = Omit<
  OfficeContentItemDescriptor,
  "priority" | "preferredWidth" | "preferredHeight"
> & {
  priority: number;
  preferredWidth: number;
  preferredHeight: number;
  valid: boolean;
};

export type NormalizedOfficeGeometryRoomDescriptor = Omit<
  OfficeGeometryRoomDescriptor,
  "contentItems"
> & {
  contentItems: readonly NormalizedOfficeContentItemDescriptor[];
  contentItemCount: number;
  sourceIndex: number;
};

export type OfficeGeometryOmissionReason =
  | "content-item-count-cap"
  | "required-minimum-exceeds-room-cap"
  | "non-required-minimum-exceeds-room-cap"
  | "canvas-capacity-exhausted"
  | "invalid-content-descriptor";

export type OfficeGeometryOmission = {
  reason: OfficeGeometryOmissionReason;
  importance: OfficeContentImportance;
  id: string | null;
};

export type OfficeGeometryOmissionSummary = {
  total: number;
  byReason: Partial<Record<OfficeGeometryOmissionReason, number>>;
  byImportance: Partial<Record<OfficeContentImportance, number>>;
  samples: Partial<Record<OfficeGeometryOmissionReason, readonly string[]>>;
  samplesByImportance: Partial<
    Record<OfficeContentImportance, readonly string[]>
  >;
};

export type OfficeContentItemRect = OfficeRect & {
  roomIndex: number;
  id: string;
  kind: string;
  importance: OfficeContentImportance;
  clipRect: OfficeRect;
  inkBounds: OfficeRect;
};

export type OfficeGeometryRow = {
  roomIndex: number;
  index: number;
  rect: OfficeRect;
};

export type OfficeGeometryResult = {
  inputDigest: string;
  normalizedInput: NormalizedOfficeGeometryInput;
  layout: OfficeLayout;
  roomHeaders: readonly (OfficeRoomHeaderLayout | null)[];
  rows: readonly OfficeGeometryRow[];
  contentItems: readonly OfficeContentItemRect[];
  omissions: readonly OfficeGeometryOmission[];
  omissionSummary: OfficeGeometryOmissionSummary;
  normalizationErrors: readonly "invalid-style-capacity"[];
  fallbackMessage: string | null;
  accessibleOverflow: OfficeOverflowMarker | null;
  resolvedCanvasWidth: number;
  resolvedCanvasHeight: number;
};

export type OfficeInputGeneration = {
  canonicalDigest: string;
};

export type PublishedOfficeLayout = OfficeLayout & {
  layoutRevision: number;
  inputDigest: string;
  generationId: string;
  normalizedInput: NormalizedOfficeGeometryInput;
  roomHeaders: readonly (OfficeRoomHeaderLayout | null)[];
  rows: readonly OfficeGeometryRow[];
  contentItems: readonly OfficeContentItemRect[];
  omissions: readonly OfficeGeometryOmission[];
  omissionSummary: OfficeGeometryOmissionSummary;
  normalizationErrors: readonly "invalid-style-capacity"[];
  fallbackMessage: string | null;
  accessibleOverflow: OfficeOverflowMarker | null;
  resolvedCanvasWidth: number;
  resolvedCanvasHeight: number;
};

const HARD_MAX_WIDTH = OFFICE_GEOMETRY.maxLogicalCanvasWidth;
const HARD_MAX_HEIGHT = OFFICE_GEOMETRY.maxLogicalCanvasHeight;
const HARD_MAX_ROOM_WIDTH = OFFICE_GEOMETRY.maxExpandedRoomWidth;
const HARD_MAX_ROOM_HEIGHT = OFFICE_GEOMETRY.maxExpandedRoomHeight;
const HARD_MAX_ROWS = OFFICE_GEOMETRY.maxLayoutRows;

function normalizeFullOfficeGeometryInput(
  input: OfficeGeometryInput,
): NormalizedOfficeGeometryInput {
  const style = {
    fixedHeaderChromeWidth: normalizeMetric(
      input.style?.fixedHeaderChromeWidth,
      OFFICE_GEOMETRY.roomHeaderChromeWidth,
      HARD_MAX_ROOM_WIDTH,
    ),
    fixedHeaderChromeHeight: normalizeMetric(
      input.style?.fixedHeaderChromeHeight,
      OFFICE_GEOMETRY.roomHeaderChromeHeight,
      HARD_MAX_ROOM_HEIGHT,
    ),
    overflowMarkerMinWidth: normalizeMetric(
      input.style?.overflowMarkerMinWidth,
      OFFICE_GEOMETRY.overflowMarkerMinWidth,
      HARD_MAX_ROOM_WIDTH,
    ),
    overflowMarkerMinHeight: normalizeMetric(
      input.style?.overflowMarkerMinHeight,
      OFFICE_GEOMETRY.overflowMarkerMinHeight,
      HARD_MAX_ROOM_HEIGHT,
    ),
    overflowMarkerGap: normalizeMetric(
      input.style?.overflowMarkerGap,
      OFFICE_GEOMETRY.overflowMarkerGap,
      HARD_MAX_ROOM_HEIGHT,
    ),
    roomSafeInset: normalizeMetric(
      input.style?.roomSafeInset,
      OFFICE_GEOMETRY.roomHeaderSafeInset,
      HARD_MAX_ROOM_WIDTH,
    ),
  };
  const minimumHeaderRoomWidth = minimumRoomWidthForTitleBox(
    style.fixedHeaderChromeWidth,
    style.roomSafeInset,
  );
  const minimumRoomWidth = Math.min(
    HARD_MAX_ROOM_WIDTH,
    Math.max(
      OFFICE_GEOMETRY.minRoomWidth,
      minimumHeaderRoomWidth,
      style.overflowMarkerMinWidth,
    ),
  );
  const minimumRoomHeight = Math.min(
    HARD_MAX_ROOM_HEIGHT,
    Math.max(
      OFFICE_GEOMETRY.minRoomHeight,
      style.fixedHeaderChromeHeight +
        style.overflowMarkerMinHeight +
        style.overflowMarkerGap,
    ),
  );
  const requestedRoomWidthCap = normalizeMetric(
    input.maximumExpandedRoomWidth,
    HARD_MAX_ROOM_WIDTH,
    HARD_MAX_ROOM_WIDTH,
  );
  const requestedCanvasWidthCap = normalizeMetric(
    input.maximumExpandedCanvasWidth,
    HARD_MAX_WIDTH,
    HARD_MAX_WIDTH,
  );
  const requestedRoomHeightCap = normalizeMetric(
    input.maximumExpandedRoomHeight,
    HARD_MAX_ROOM_HEIGHT,
    HARD_MAX_ROOM_HEIGHT,
  );
  const requestedCanvasHeightCap = normalizeMetric(
    input.maximumExpandedCanvasHeight,
    HARD_MAX_HEIGHT,
    HARD_MAX_HEIGHT,
  );
  const minimumLogicalCanvasWidth = normalizeMetric(
    input.minimumLogicalCanvasWidth,
    OFFICE_GEOMETRY.minOfficeWidth,
    HARD_MAX_WIDTH,
  );
  const minimumLogicalCanvasHeight = normalizeMetric(
    input.minimumLogicalCanvasHeight,
    OFFICE_GEOMETRY.ceoBandHeight + OFFICE_GEOMETRY.hallwayHeight,
    HARD_MAX_HEIGHT,
  );
  const maximumExpandedCanvasWidth = Math.min(
    HARD_MAX_WIDTH,
    Math.max(
      minimumLogicalCanvasWidth,
      minimumRoomWidth,
      normalizeMetric(
        input.maximumExpandedCanvasWidth,
        HARD_MAX_WIDTH,
        HARD_MAX_WIDTH,
      ),
    ),
  );
  const maximumExpandedCanvasHeight = Math.min(
    HARD_MAX_HEIGHT,
    Math.max(
      minimumLogicalCanvasHeight,
      minimumRoomHeight,
      normalizeMetric(
        input.maximumExpandedCanvasHeight,
        HARD_MAX_HEIGHT,
        HARD_MAX_HEIGHT,
      ),
    ),
  );
  const maximumExpandedRoomWidth = Math.min(
    HARD_MAX_ROOM_WIDTH,
    maximumExpandedCanvasWidth,
    Math.max(
      minimumRoomWidth,
      normalizeMetric(
        input.maximumExpandedRoomWidth,
        HARD_MAX_ROOM_WIDTH,
        HARD_MAX_ROOM_WIDTH,
      ),
    ),
  );
  const maximumExpandedRoomHeight = Math.min(
    HARD_MAX_ROOM_HEIGHT,
    maximumExpandedCanvasHeight,
    Math.max(
      minimumRoomHeight,
      normalizeMetric(
        input.maximumExpandedRoomHeight,
        HARD_MAX_ROOM_HEIGHT,
        HARD_MAX_ROOM_HEIGHT,
      ),
    ),
  );
  const maxContentItems = normalizeCapacity(
    input.maxContentItems,
    DEFAULT_MAX_CONTENT_ITEMS,
  );
  const maxLayoutRows = Math.max(
    1,
    Math.min(
      HARD_MAX_ROWS,
      normalizeMetric(input.maxLayoutRows, HARD_MAX_ROWS, HARD_MAX_ROWS),
    ),
  );
  const rooms = input.rooms
    .map((room, index) =>
      normalizeRoomDescriptor(
        room,
        index,
        maximumExpandedRoomWidth,
        maximumExpandedRoomHeight,
      ),
    )
    .sort(compareRoomDescriptors)
    .slice(0, OFFICE_GEOMETRY.maxRooms);
  return {
    availableViewportWidth: normalizeMetric(
      input.availableViewportWidth,
      0,
      maximumExpandedCanvasWidth,
    ),
    availableViewportHeight: normalizeMetric(
      input.availableViewportHeight,
      0,
      maximumExpandedCanvasHeight,
    ),
    minimumLogicalCanvasWidth,
    minimumLogicalCanvasHeight,
    minimumRoomWidth,
    minimumRoomHeight,
    maximumExpandedCanvasWidth,
    maximumExpandedCanvasHeight,
    maximumExpandedRoomWidth,
    maximumExpandedRoomHeight,
    maxContentItems,
    maxLayoutRows,
    overflowMode: "logical-scroll",
    fontKey: input.fontKey ?? "Inter, ui-sans-serif, system-ui, sans-serif",
    fontReady: input.fontReady !== false,
    titleMode: input.titleMode === "compact" ? "compact" : "expand",
    roomAlignment:
      input.roomAlignment === "center" || input.roomAlignment === "right"
        ? input.roomAlignment
        : "left",
    ceoReceptionCount: normalizeMetric(
      input.ceoReceptionCount,
      0,
      OFFICE_GEOMETRY.maxReceptionDesks,
    ),
    ceoContentItems: (input.ceoContentItems ?? []).map((item, index) =>
      normalizeContentDescriptor(item, index),
    ),
    ceoContentItemCount: input.ceoContentItems?.length ?? 0,
    styleCapacityInvalid:
      minimumHeaderRoomWidth > HARD_MAX_ROOM_WIDTH ||
      requestedRoomWidthCap < minimumHeaderRoomWidth ||
      requestedCanvasWidthCap < minimumHeaderRoomWidth ||
      requestedRoomWidthCap < minimumRoomWidth ||
      requestedCanvasWidthCap < minimumRoomWidth ||
      requestedRoomHeightCap < minimumRoomHeight ||
      requestedCanvasHeightCap < minimumRoomHeight,
    style,
    rooms,
  };
}

export function normalizeOfficeGeometryInput(
  input: OfficeGeometryInput,
): NormalizedOfficeGeometryInput {
  return boundNormalizedOfficeGeometryInput(
    normalizeFullOfficeGeometryInput(input),
  );
}

export function resolveOfficeGeometry(
  input: OfficeGeometryInput,
): OfficeGeometryResult {
  const normalizedInput = normalizeFullOfficeGeometryInput(input);
  const inputDigest = stableDigest(canonicalSerialize(normalizedInput));
  const boundedNormalizedInput =
    boundNormalizedOfficeGeometryInput(normalizedInput);
  const styleInvalid =
    normalizedInput.minimumRoomWidth >
      normalizedInput.maximumExpandedRoomWidth ||
    normalizedInput.styleCapacityInvalid ||
    normalizedInput.style.fixedHeaderChromeHeight +
      normalizedInput.style.overflowMarkerMinHeight +
      normalizedInput.style.overflowMarkerGap >
      normalizedInput.maximumExpandedRoomHeight;
  const baseWidth = Math.min(
    normalizedInput.maximumExpandedCanvasWidth,
    Math.max(
      normalizedInput.minimumLogicalCanvasWidth,
      normalizedInput.availableViewportWidth,
      ...normalizedInput.rooms.map(
        (room) =>
          Math.max(
            resolveOfficeRoomHeader(room, normalizedInput).width,
            room.headerMinWidth ?? 0,
            room.headerMinTitleBoxWidth ?? 0,
            room.contentMinWidth ?? 0,
            minimumContentWidth(
              room.contentItems,
              room.flow,
              normalizedInput.maxContentItems,
            ) +
              OFFICE_GEOMETRY.roomPadding * 2,
            room.preferredWidth ?? 0,
          ) + 24,
      ),
      minimumContentWidth(
        normalizedInput.ceoContentItems,
        "wrap-row",
        normalizedInput.maxContentItems,
      ) +
        OFFICE_GEOMETRY.ceoEdgePadding * 2,
    ),
  );
  const invalidMinimumCapacity =
    normalizedInput.minimumRoomWidth >
      normalizedInput.maximumExpandedRoomWidth ||
    normalizedInput.minimumRoomHeight >
      normalizedInput.maximumExpandedRoomHeight;
  if (styleInvalid || invalidMinimumCapacity) {
    const fallbackLayout = resolveOfficeLayout(
      normalizedInput.minimumLogicalCanvasWidth,
      [],
      normalizedInput.roomAlignment,
      OFFICE_GEOMETRY.ceoBandHeight,
      0,
      normalizedInput.maximumExpandedCanvasHeight,
    );
    const fallback = withLayoutBounds(
      {
        ...fallbackLayout,
        totalHeight: Math.min(
          normalizedInput.maximumExpandedCanvasHeight,
          fallbackLayout.totalHeight,
        ),
        fallbackMessage: "Office layout unavailable",
      },
      [],
    );
    fallback.ceoOverflowMarkerRect = overflowMarkerRect(
      contentRegionRoom(fallback, fallback.ceoContentRect, -1),
      normalizedInput,
    );
    return {
      inputDigest,
      normalizedInput: boundedNormalizedInput,
      layout: {
        ...fallback,
        overflowMarker: { label: "Office layout unavailable", required: true },
      },
      roomHeaders: [],
      rows: [],
      contentItems: [],
      omissions: [],
      omissionSummary: emptyOmissionSummary(),
      normalizationErrors: ["invalid-style-capacity"],
      fallbackMessage: "Office layout unavailable",
      accessibleOverflow: {
        label: "Office layout unavailable",
        required: true,
      },
      resolvedCanvasWidth: fallback.officeWidth,
      resolvedCanvasHeight: fallback.totalHeight,
    };
  }
  const initialCeoBlocks = resolveCeoBlockLayout(
    baseWidth,
    normalizedInput.ceoReceptionCount,
    Math.min(
      normalizedInput.maximumExpandedCanvasHeight,
      normalizedInput.maximumExpandedRoomHeight,
    ),
  );
  const resolvedCeoBandHeight = estimateCeoBandHeight(
    normalizedInput.ceoContentItems,
    initialCeoBlocks.ceoContentWidth,
    normalizedInput,
    initialCeoBlocks.ceoBandHeight,
  );
  const presentations = normalizedInput.rooms.map((room) => ({
    sourceIndex: room.sourceIndex,
    deskCount: room.deskCount,
    standingCount: room.standingCount,
    headerMinWidth: resolveOfficeRoomHeader(room, normalizedInput).width,
    headerMinTitleBoxWidth: room.headerMinTitleBoxWidth,
    headerMinHeight: room.headerMinHeight,
    contentMinWidth: Math.max(
      room.contentMinWidth ?? 0,
      minimumContentWidth(
        room.contentItems,
        room.flow,
        normalizedInput.maxContentItems,
      ) +
        OFFICE_GEOMETRY.roomPadding * 2,
    ),
    preferredWidth: Math.min(
      normalizedInput.maximumExpandedRoomWidth,
      Math.max(room.preferredWidth ?? 0, normalizedInput.minimumRoomWidth),
    ),
    preferredHeight: Math.min(
      normalizedInput.maximumExpandedRoomHeight,
      Math.max(room.preferredHeight ?? 0, normalizedInput.minimumRoomHeight),
    ),
    maximumWidth: normalizedInput.maximumExpandedRoomWidth,
    maximumHeight: normalizedInput.maximumExpandedRoomHeight,
  }));
  const baseLayout = resolveOfficeLayout(
    baseWidth,
    presentations,
    normalizedInput.roomAlignment,
    resolvedCeoBandHeight,
    normalizedInput.ceoReceptionCount,
    Math.min(
      normalizedInput.maximumExpandedCanvasHeight,
      normalizedInput.maximumExpandedRoomHeight,
    ),
  );
  const omissionAccumulator = createOmissionAccumulator();
  const availableRooms = baseLayout.rooms.filter(
    (room) =>
      room.row < normalizedInput.maxLayoutRows &&
      room.y + room.height <= normalizedInput.maximumExpandedCanvasHeight,
  );
  normalizedInput.rooms.forEach((room) => {
    if (
      !availableRooms.some((candidate) => candidate.index === room.sourceIndex)
    ) {
      omissionAccumulator.add({
        reason: "canvas-capacity-exhausted",
        importance: "required",
        id: room.id,
      });
    }
  });
  const layout = withLayoutBounds(
    {
      ...baseLayout,
      officeWidth: baseWidth,
      totalHeight: Math.min(
        normalizedInput.maximumExpandedCanvasHeight,
        Math.max(
          baseLayout.totalHeight,
          normalizedInput.minimumLogicalCanvasHeight,
        ),
      ),
      rooms: availableRooms,
    },
    normalizedInput.rooms.reduce<(OfficeRoomHeaderLayout | null)[]>(
      (headers, room) => {
        headers[room.sourceIndex] = resolveOfficeRoomHeader(
          room,
          normalizedInput,
        );
        return headers;
      },
      [],
    ),
  );
  const contentItems: OfficeContentItemRect[] = [];
  normalizedInput.rooms.forEach((room) => {
    const rect = layout.rooms.find(({ index }) => index === room.sourceIndex);
    if (!rect) {
      return;
    }
    const selectedItems = normalizeContentItems(
      room.contentItems ?? [],
      normalizedInput.maxContentItems,
    );
    selectedItems.omitted.forEach((item) =>
      omissionAccumulator.add({
        reason: "content-item-count-cap",
        importance: item.importance,
        id: item.id,
      }),
    );
    const placed = placeContentItems(
      rect,
      room,
      selectedItems.selected,
      normalizedInput,
    );
    placed.items.forEach((item) => contentItems.push(item));
    placed.omissions.forEach((omission) => omissionAccumulator.add(omission));
    if (
      placed.requiredOverflow ||
      selectedItems.omitted.some(({ importance }) => importance === "required")
    ) {
      rect.overflowMarkerRect = overflowMarkerRect(rect, normalizedInput);
    }
  });
  const resolvedReceptionIndexes = new Set(
    layout.ceoBlocks.receptions.map(({ index }) => index),
  );
  for (let index = 0; index < normalizedInput.ceoReceptionCount; index += 1) {
    if (!resolvedReceptionIndexes.has(index)) {
      omissionAccumulator.add({
        reason: "canvas-capacity-exhausted",
        importance: "required",
        id: `reception-${index}`,
      });
    }
  }
  const ceoDescriptor: OfficeGeometryRoomDescriptor = {
    id: "ceo-office",
    role: "ceo",
    region: "ceo",
    order: 0,
    flow: "wrap-row",
    spanPolicy: "multi-row",
    title: "CEO Office",
    hostTitle: "CEO",
    deskCount: 0,
    standingCount: 0,
    contentItems: normalizedInput.ceoContentItems,
  };
  const ceoItems = normalizeContentItems(
    normalizedInput.ceoContentItems,
    normalizedInput.maxContentItems,
  );
  ceoItems.omitted.forEach((item) =>
    omissionAccumulator.add({
      reason: "content-item-count-cap",
      importance: item.importance,
      id: item.id,
    }),
  );
  const ceoPlaced = placeContentItems(
    contentRegionRoom(layout, layout.ceoContentRect, -1),
    ceoDescriptor,
    ceoItems.selected,
    normalizedInput,
  );
  ceoPlaced.items.forEach((item) => contentItems.push(item));
  ceoPlaced.omissions.forEach((omission) => omissionAccumulator.add(omission));
  if (
    ceoPlaced.requiredOverflow ||
    ceoItems.omitted.some(({ importance }) => importance === "required") ||
    resolvedReceptionIndexes.size < normalizedInput.ceoReceptionCount
  ) {
    layout.ceoOverflowMarkerRect = overflowMarkerRect(
      contentRegionRoom(layout, layout.ceoContentRect, -1),
      normalizedInput,
    );
  }
  const rows = resolveRows(layout);
  const omissionRecords = omissionAccumulator.records();
  const omissionSummary = omissionAccumulator.summary();
  const accessibleOverflow = omissionSummary.byImportance.required
    ? { label: "Some required Office content is not shown.", required: true }
    : null;
  const layoutWithOverflow = accessibleOverflow
    ? { ...layout, overflowMarker: accessibleOverflow }
    : layout;
  return {
    inputDigest,
    normalizedInput: boundedNormalizedInput,
    layout: layoutWithOverflow,
    roomHeaders: layout.rooms.map((room) => room.header ?? null),
    rows,
    contentItems,
    omissions: omissionRecords,
    omissionSummary,
    normalizationErrors: [],
    fallbackMessage: null,
    accessibleOverflow,
    resolvedCanvasWidth: layoutWithOverflow.officeWidth,
    resolvedCanvasHeight: layoutWithOverflow.totalHeight,
  };
}

export function resolveOfficeRoomHeader(
  room: Pick<
    OfficeGeometryRoomDescriptor,
    "title" | "hostTitle" | "visualTitle" | "visualHostTitle"
  > & {
    headerMinWidth?: number;
    headerMinTitleBoxWidth?: number;
  },
  input: Pick<
    NormalizedOfficeGeometryInput,
    "titleMode" | "maximumExpandedRoomWidth" | "style" | "fontKey" | "fontReady"
  >,
): OfficeRoomHeaderLayout {
  const { workspace, host } = officeHeaderLabels(
    String(room.title ?? "ROOM"),
    String(room.hostTitle ?? "HOST"),
    input.titleMode,
  );
  let visualWorkspace = room.visualTitle ?? workspace;
  let visualHost = room.visualHostTitle ?? host;
  const titleChromeWidth = input.style.fixedHeaderChromeWidth;
  const actionWidth = OFFICE_GEOMETRY.roomHeaderActionWidth;
  const actionGap = OFFICE_GEOMETRY.roomHeaderActionGap;
  const closeGap = OFFICE_GEOMETRY.roomHeaderCloseGap;
  const maxWidth = Math.max(
    minimumRoomWidthForTitleBox(titleChromeWidth, input.style.roomSafeInset),
    input.maximumExpandedRoomWidth,
  );
  const maxTitleBoxWidth = Math.max(
    titleChromeWidth,
    maxWidth -
      input.style.roomSafeInset * 2 -
      2 * (actionWidth + actionGap + actionWidth + closeGap),
  );
  let titleBoxWidth = Math.max(
    titleChromeWidth,
    room.headerMinTitleBoxWidth ?? 0,
    titleChromeWidth +
      measureOfficeText(visualWorkspace) +
      measureOfficeText(visualHost),
  );
  let width = minimumRoomWidthForTitleBox(
    titleBoxWidth,
    input.style.roomSafeInset,
  );
  let emergencyEllipsis = false;
  if (titleBoxWidth > maxTitleBoxWidth) {
    emergencyEllipsis = true;
    const available = Math.max(0, maxTitleBoxWidth - titleChromeWidth);
    const workspaceBudget = Math.floor(available * 0.52);
    const hostBudget = Math.max(0, available - workspaceBudget);
    visualWorkspace = fitOfficeLabel(visualWorkspace, workspaceBudget);
    visualHost = fitOfficeLabel(visualHost, hostBudget);
    titleBoxWidth = Math.min(
      maxTitleBoxWidth,
      titleChromeWidth +
        measureOfficeText(visualWorkspace) +
        measureOfficeText(visualHost),
    );
    width = minimumRoomWidthForTitleBox(
      titleBoxWidth,
      input.style.roomSafeInset,
    );
  }
  width = Math.max(width, room.headerMinWidth ?? 0);
  return {
    workspace: visualWorkspace,
    host: visualHost,
    width: Math.min(maxWidth, Math.ceil(width)),
    titleBoxX: 0,
    titleBoxWidth: Math.max(titleChromeWidth, Math.ceil(titleBoxWidth)),
    renameX: 0,
    closeX: 0,
    renameWidth: actionWidth,
    closeWidth: actionWidth,
    actionWidth,
    actionGap,
    closeGap,
    height: Math.max(
      OFFICE_GEOMETRY.roomHeaderHeight,
      input.style.fixedHeaderChromeHeight,
    ),
    emergencyEllipsis,
  };
}

export function officeHeaderLabels(
  title: string,
  hostTitle: string,
  titleMode: OfficeLongRoomTitleMode,
) {
  return {
    workspace: titleMode === "compact" ? compactOfficeLabel(title, 18) : title,
    host:
      titleMode === "compact" ? compactOfficeLabel(hostTitle, 16) : hostTitle,
  };
}

export class OfficeLayoutPublisher {
  private revision = 0;
  private currentDigest: string | null = null;
  private currentLayout: PublishedOfficeLayout | null = null;
  private renderedRevision = 0;

  publish(
    generation: OfficeInputGeneration,
    geometry: OfficeGeometryResult,
  ): PublishedOfficeLayout {
    if (geometry.inputDigest !== generation.canonicalDigest) {
      throw new Error(
        "Office layout geometry does not match its input generation.",
      );
    }
    if (
      this.currentLayout &&
      this.currentDigest === generation.canonicalDigest
    ) {
      return this.currentLayout;
    }
    this.revision += 1;
    this.currentDigest = generation.canonicalDigest;
    const snapshot = {
      ...geometry.layout,
      generationId: generation.canonicalDigest,
      layoutRevision: this.revision,
      inputDigest: generation.canonicalDigest,
      normalizedInput: geometry.normalizedInput,
      roomHeaders: geometry.roomHeaders,
      rows: geometry.rows,
      contentItems: geometry.contentItems,
      omissions: geometry.omissions,
      omissionSummary: geometry.omissionSummary,
      normalizationErrors: geometry.normalizationErrors,
      fallbackMessage: geometry.fallbackMessage,
      accessibleOverflow: geometry.accessibleOverflow,
      resolvedCanvasWidth: geometry.resolvedCanvasWidth,
      resolvedCanvasHeight: geometry.resolvedCanvasHeight,
    };
    this.currentLayout = deepFreeze(
      cloneValue(snapshot),
    ) as PublishedOfficeLayout;
    return this.currentLayout;
  }

  ackCanvasRendered(revision: number) {
    if (!this.currentLayout || revision !== this.currentLayout.layoutRevision) {
      return false;
    }
    this.renderedRevision = revision;
    return true;
  }

  get canvasRenderedRevision() {
    return this.renderedRevision;
  }

  isCanvasReady(revision: number) {
    return (
      this.currentLayout?.layoutRevision === revision &&
      this.renderedRevision === revision
    );
  }
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as T;
  }
  if (value && typeof value === "object") {
    const clone = {} as Record<string, unknown>;
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      clone[key] = cloneValue(item);
    });
    return clone as T;
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach((child) =>
      deepFreeze(child),
    );
    Object.freeze(value);
  }
  return value;
}

function normalizeContentItems(
  items: readonly OfficeContentItemLike[],
  maxContentItems: number,
) {
  const normalized = items.map((item, index) =>
    normalizeContentDescriptor(item, index),
  );
  const ordered = [...normalized].sort((left, right) => {
    const importance =
      importanceRank(
        isImportance(left.importance) ? left.importance : "optional",
      ) -
      importanceRank(
        isImportance(right.importance) ? right.importance : "optional",
      );
    if (importance !== 0) {
      return importance;
    }
    if (left.importance === "required" && right.importance === "required") {
      return left.order - right.order || left.id.localeCompare(right.id);
    }
    return (
      right.priority - left.priority ||
      left.order - right.order ||
      left.id.localeCompare(right.id)
    );
  });
  return {
    selected: ordered.slice(0, maxContentItems),
    omitted: ordered.slice(maxContentItems),
  };
}

function placeContentItems(
  room: OfficeRoomRect,
  descriptor: OfficeGeometryRoomDescriptor,
  items: ReturnType<typeof normalizeContentItems>["selected"],
  input: NormalizedOfficeGeometryInput,
) {
  const result: OfficeContentItemRect[] = [];
  const omissions: OfficeGeometryOmission[] = [];
  let cursorX = room.contentSafeRect.x;
  let cursorY = room.contentSafeRect.y;
  let rowHeight = 0;
  let rowIndex = 0;
  let rowItemCount = 0;
  let requiredOverflow = false;
  const gap = 8;
  const flow = descriptor.flow ?? "wrap-row";
  items.forEach((item) => {
    const importance = isImportance(item.importance)
      ? item.importance
      : "optional";
    if (!item.valid) {
      omissions.push({
        reason: "invalid-content-descriptor",
        importance,
        id: item.id,
      });
      if (importance === "required") {
        requiredOverflow = true;
      }
      return;
    }
    if (
      item.minWidth > input.maximumExpandedRoomWidth ||
      item.minHeight > input.maximumExpandedRoomHeight ||
      item.minWidth > room.contentSafeRect.width ||
      item.minHeight > room.contentSafeRect.height
    ) {
      const reason: OfficeGeometryOmissionReason =
        importance === "required"
          ? "required-minimum-exceeds-room-cap"
          : "non-required-minimum-exceeds-room-cap";
      omissions.push({ reason, importance, id: item.id });
      if (importance === "required") {
        requiredOverflow = true;
      }
      return;
    }
    const availableWidth = room.contentSafeRect.width;
    const preferredWidth = Math.max(
      item.minWidth,
      Math.min(item.preferredWidth, availableWidth),
    );
    const remainingWidth = Math.max(
      0,
      room.contentSafeRect.x + availableWidth - cursorX,
    );
    const width =
      descriptor.spanPolicy === "multi-row"
        ? availableWidth
        : descriptor.spanPolicy === "remaining" && rowItemCount > 0
          ? Math.max(item.minWidth, Math.min(preferredWidth, remainingWidth))
          : preferredWidth;
    const height = Math.max(
      item.minHeight,
      Math.min(item.preferredHeight, input.maximumExpandedRoomHeight),
    );
    const wouldWrap =
      flow === "column"
        ? rowItemCount > 0
        : flow === "wrap-row" || flow === "grid"
          ? rowItemCount > 0 &&
            cursorX + width > room.contentSafeRect.x + availableWidth
          : false;
    const spansCurrentRow =
      descriptor.spanPolicy === "multi-row" && rowItemCount > 0;
    if (wouldWrap || spansCurrentRow) {
      rowIndex += 1;
      cursorX = room.contentSafeRect.x;
      cursorY += rowHeight + gap;
      rowHeight = 0;
      rowItemCount = 0;
    }
    if (
      flow === "row" &&
      rowItemCount > 0 &&
      cursorX + width > room.contentSafeRect.x + availableWidth
    ) {
      omissions.push({
        reason: "canvas-capacity-exhausted",
        importance,
        id: item.id,
      });
      if (importance === "required") {
        requiredOverflow = true;
      }
      return;
    }
    if (
      rowIndex >= input.maxLayoutRows ||
      cursorY + height > room.contentSafeRect.y + room.contentSafeRect.height
    ) {
      omissions.push({
        reason: "canvas-capacity-exhausted",
        importance,
        id: item.id,
      });
      if (importance === "required") {
        requiredOverflow = true;
      }
      return;
    }
    const rect = { x: cursorX, y: cursorY, width, height };
    const clipRect = {
      x: Math.max(room.clipRect.x, rect.x),
      y: Math.max(room.clipRect.y, rect.y),
      width: Math.min(
        rect.width,
        room.clipRect.x + room.clipRect.width - rect.x,
      ),
      height: Math.min(
        rect.height,
        room.clipRect.y + room.clipRect.height - rect.y,
      ),
    };
    result.push({
      ...rect,
      roomIndex: room.index,
      id: item.id,
      kind: item.kind,
      importance,
      clipRect,
      inkBounds: clipRect,
    });
    cursorX += width + gap;
    rowHeight = Math.max(rowHeight, height);
    rowItemCount += 1;
  });
  return { items: result, omissions, requiredOverflow };
}

function resolveRows(layout: OfficeLayout): OfficeGeometryRow[] {
  const rows = new Map<string, OfficeGeometryRow>();
  layout.rooms.forEach((room) => {
    const key = `${room.row}`;
    const prior = rows.get(key);
    const rect = prior
      ? unionRects(prior.rect, room.outerRect)
      : room.outerRect;
    rows.set(key, { roomIndex: room.index, index: room.row, rect });
  });
  return [...rows.values()].sort((left, right) => left.index - right.index);
}

function estimateCeoBandHeight(
  items: readonly OfficeContentItemDescriptor[],
  contentWidth: number,
  input: NormalizedOfficeGeometryInput,
  baseHeight: number,
) {
  const selected = normalizeContentItems(items, input.maxContentItems).selected;
  const width = Math.max(1, contentWidth - 16);
  const gap = 8;
  let cursorX = 0;
  let contentHeight = 0;
  let rowHeight = 0;
  selected.forEach((item) => {
    if (
      !item.valid ||
      item.minWidth > width ||
      item.minHeight > input.maximumExpandedRoomHeight
    ) {
      return;
    }
    const itemWidth = Math.min(item.preferredWidth, width);
    const itemHeight = Math.min(
      item.preferredHeight,
      input.maximumExpandedRoomHeight,
    );
    if (cursorX > 0 && cursorX + itemWidth > width) {
      contentHeight += rowHeight + gap;
      cursorX = 0;
      rowHeight = 0;
    }
    cursorX += itemWidth + gap;
    rowHeight = Math.max(rowHeight, itemHeight);
  });
  contentHeight += rowHeight;
  return Math.min(
    input.maximumExpandedCanvasHeight,
    input.maximumExpandedRoomHeight,
    Math.max(baseHeight, contentHeight + 56),
  );
}

function contentRegionRoom(
  layout: OfficeLayout,
  contentRect: OfficeRect,
  index: number,
): OfficeRoomRect {
  return {
    index,
    column: 0,
    row: 0,
    x: layout.ceoRect.x,
    y: layout.ceoRect.y,
    width: layout.ceoRect.width,
    height: layout.ceoRect.height,
    deskColumns: 0,
    standingColumns: 0,
    deskRows: 0,
    standingRows: 0,
    outerRect: layout.ceoRect,
    wallRect: layout.ceoRect,
    headerRect: layout.ceoRect,
    contentSafeRect: contentRect,
    clipRect: layout.ceoRect,
    inkBounds: layout.ceoRect,
    shadowAllowance: 0,
    selectionStrokeAllowance: 0,
  };
}

function withLayoutBounds(
  layout: OfficeLayout,
  headers: readonly (OfficeRoomHeaderLayout | null)[],
): OfficeLayout {
  const rooms = layout.rooms.map((room) => ({
    ...room,
    header: headers[room.index]
      ? positionOfficeRoomHeader(room.headerRect, headers[room.index]!)
      : room.header,
  }));
  return { ...layout, rooms };
}

function positionOfficeRoomHeader(
  headerRect: OfficeRect,
  header: OfficeRoomHeaderLayout,
): OfficeRoomHeaderLayout {
  const titleBoxX = Math.max(0, (headerRect.width - header.titleBoxWidth) / 2);
  return {
    ...header,
    titleBoxX,
    renameX: titleBoxX + header.titleBoxWidth + header.actionGap,
    closeX: Math.max(0, headerRect.width - header.closeWidth),
  };
}

export function minimumRoomWidthForTitleBox(
  titleBoxWidth: number,
  roomSafeInset: number = OFFICE_GEOMETRY.roomHeaderSafeInset,
) {
  return Math.ceil(
    Math.max(0, titleBoxWidth) +
      2 *
        (OFFICE_GEOMETRY.roomHeaderActionWidth +
          OFFICE_GEOMETRY.roomHeaderActionGap +
          OFFICE_GEOMETRY.roomHeaderActionWidth +
          OFFICE_GEOMETRY.roomHeaderCloseGap) +
      Math.max(0, roomSafeInset) * 2,
  );
}

function overflowMarkerRect(
  room: OfficeRoomRect,
  input: NormalizedOfficeGeometryInput,
): OfficeRect {
  const width = Math.min(
    input.style.overflowMarkerMinWidth,
    room.contentSafeRect.width,
  );
  const height = Math.min(
    input.style.overflowMarkerMinHeight,
    room.contentSafeRect.height,
  );
  return {
    x: room.contentSafeRect.x,
    y: Math.max(
      room.contentSafeRect.y,
      room.contentSafeRect.y + room.contentSafeRect.height - height,
    ),
    width,
    height,
  };
}

function createOmissionAccumulator() {
  const records: OfficeGeometryOmission[] = [];
  const byReason: OfficeGeometryOmissionSummary["byReason"] = {};
  const byImportance: OfficeGeometryOmissionSummary["byImportance"] = {};
  const samples: OfficeGeometryOmissionSummary["samples"] = {};
  const samplesByImportance: OfficeGeometryOmissionSummary["samplesByImportance"] =
    {};
  let total = 0;
  return {
    add({ reason, importance, id }: OfficeGeometryOmission) {
      total += 1;
      byReason[reason] = (byReason[reason] ?? 0) + 1;
      byImportance[importance] = (byImportance[importance] ?? 0) + 1;
      if (id && (samples[reason]?.length ?? 0) < MAX_OMISSION_SAMPLES) {
        samples[reason] = [...(samples[reason] ?? []), id];
      }
      if (
        id &&
        (samplesByImportance[importance]?.length ?? 0) < MAX_OMISSION_SAMPLES
      ) {
        samplesByImportance[importance] = [
          ...(samplesByImportance[importance] ?? []),
          id,
        ];
      }
      if (
        records.filter(
          (record) =>
            record.reason === reason && record.importance === importance,
        ).length < MAX_OMISSION_SAMPLES
      ) {
        records.push({ reason, importance, id });
      }
    },
    records() {
      return records.slice();
    },
    summary(): OfficeGeometryOmissionSummary {
      return { total, byReason, byImportance, samples, samplesByImportance };
    },
  };
}

function emptyOmissionSummary(): OfficeGeometryOmissionSummary {
  return {
    total: 0,
    byReason: {},
    byImportance: {},
    samples: {},
    samplesByImportance: {},
  };
}

function unionRects(left: OfficeRect, right: OfficeRect): OfficeRect {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottom = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: rightEdge - x, height: bottom - y };
}

function normalizeMetric(
  value: number | undefined,
  fallback: number,
  maximum: number,
) {
  const numeric =
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(maximum, Math.floor(numeric)));
}

function normalizeRoomDescriptor(
  room: OfficeGeometryRoomDescriptor,
  index: number,
  maximumRoomWidth: number,
  maximumRoomHeight: number,
): NormalizedOfficeGeometryRoomDescriptor {
  const flow =
    room.flow === "row" ||
    room.flow === "column" ||
    room.flow === "grid" ||
    room.flow === "wrap-row"
      ? room.flow
      : undefined;
  const spanPolicy =
    room.spanPolicy === "single" ||
    room.spanPolicy === "multi-row" ||
    room.spanPolicy === "remaining"
      ? room.spanPolicy
      : undefined;
  const region =
    room.region === "ceo" ||
    room.region === "agent-bar" ||
    room.region === "work"
      ? room.region
      : undefined;
  return {
    id:
      typeof room.id === "string" && room.id.trim().length > 0
        ? room.id
        : `room-${index}`,
    role: typeof room.role === "string" ? room.role : undefined,
    precedence: normalizeMetric(room.precedence, 0, OFFICE_GEOMETRY.maxRooms),
    region,
    order: normalizeMetric(room.order, index, OFFICE_GEOMETRY.maxRooms),
    flow,
    spanPolicy,
    title: String(room.title ?? "ROOM"),
    hostTitle: String(room.hostTitle ?? "HOST"),
    visualTitle:
      typeof room.visualTitle === "string" ? room.visualTitle : undefined,
    visualHostTitle:
      typeof room.visualHostTitle === "string"
        ? room.visualHostTitle
        : undefined,
    actions: {
      rename: Boolean(room.actions?.rename),
      close: Boolean(room.actions?.close),
      createSeat: Boolean(room.actions?.createSeat),
    },
    deskCount: normalizeMetric(room.deskCount, 0, OFFICE_GEOMETRY.desksPerRoom),
    standingCount: normalizeMetric(
      room.standingCount,
      0,
      OFFICE_GEOMETRY.standingColumns * 2,
    ),
    headerMinWidth: normalizeMetric(room.headerMinWidth, 0, maximumRoomWidth),
    headerMinTitleBoxWidth: normalizeMetric(
      room.headerMinTitleBoxWidth,
      0,
      maximumRoomWidth,
    ),
    headerMinHeight: normalizeMetric(
      room.headerMinHeight,
      OFFICE_GEOMETRY.roomHeaderHeight,
      maximumRoomHeight,
    ),
    contentMinWidth: normalizeMetric(room.contentMinWidth, 0, maximumRoomWidth),
    preferredWidth: normalizeMetric(room.preferredWidth, 0, maximumRoomWidth),
    preferredHeight: normalizeMetric(
      room.preferredHeight,
      0,
      maximumRoomHeight,
    ),
    contentItems: (room.contentItems ?? []).map((item, itemIndex) =>
      normalizeContentDescriptor(item, itemIndex),
    ),
    contentItemCount: room.contentItems?.length ?? 0,
    sourceIndex: index,
  };
}

function compareRoomDescriptors(
  left: NormalizedOfficeGeometryRoomDescriptor,
  right: NormalizedOfficeGeometryRoomDescriptor,
) {
  const regionRank = (
    region: NormalizedOfficeGeometryRoomDescriptor["region"],
  ) =>
    region === "ceo"
      ? 0
      : region === "agent-bar"
        ? 1
        : region === "work"
          ? 2
          : 3;
  return (
    regionRank(left.region) - regionRank(right.region) ||
    (left.precedence ?? 0) - (right.precedence ?? 0) ||
    (left.order ?? 0) - (right.order ?? 0) ||
    left.id.localeCompare(right.id) ||
    left.sourceIndex - right.sourceIndex
  );
}

function boundNormalizedOfficeGeometryInput(
  input: NormalizedOfficeGeometryInput,
): NormalizedOfficeGeometryInput {
  return {
    ...input,
    ceoContentItems: normalizeContentItems(
      input.ceoContentItems,
      input.maxContentItems,
    ).selected,
    rooms: input.rooms.map((room) => ({
      ...room,
      contentItems: normalizeContentItems(
        room.contentItems,
        input.maxContentItems,
      ).selected,
    })),
  };
}

function normalizeContentDescriptor(
  item: OfficeContentItemLike,
  index: number,
): NormalizedOfficeContentItemDescriptor {
  const valid =
    item.valid !== false &&
    typeof item.id === "string" &&
    item.id.trim().length > 0 &&
    typeof item.kind === "string" &&
    item.kind.trim().length > 0 &&
    isImportance(item.importance) &&
    typeof item.order === "number" &&
    Number.isFinite(item.order) &&
    item.order >= 0 &&
    typeof item.minWidth === "number" &&
    Number.isFinite(item.minWidth) &&
    item.minWidth >= 0 &&
    typeof item.minHeight === "number" &&
    Number.isFinite(item.minHeight) &&
    item.minHeight >= 0;
  const minWidth = normalizeMetric(item.minWidth, 0, HARD_MAX_ROOM_WIDTH);
  const minHeight = normalizeMetric(item.minHeight, 0, HARD_MAX_ROOM_HEIGHT);
  return {
    id:
      typeof item.id === "string" && item.id.trim().length > 0
        ? item.id
        : `item-${index}`,
    kind:
      typeof item.kind === "string" && item.kind.trim().length > 0
        ? item.kind
        : "unknown",
    importance: isImportance(item.importance) ? item.importance : "optional",
    order: normalizeMetric(item.order, index, HARD_MAX_ROWS),
    priority: normalizeMetric(item.priority, 0, HARD_MAX_ROWS),
    minWidth,
    minHeight,
    preferredWidth: normalizeMetric(
      item.preferredWidth,
      minWidth,
      HARD_MAX_ROOM_WIDTH,
    ),
    preferredHeight: normalizeMetric(
      item.preferredHeight,
      minHeight,
      HARD_MAX_ROOM_HEIGHT,
    ),
    valid,
  };
}

function canonicalSerialize(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalSerialize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalSerialize(record[key])}`)
      .join(",")}}`;
  }
  return "null";
}

function stableDigest(canonicalInput: string) {
  let hash = 14695981039346656037n;
  for (let index = 0; index < canonicalInput.length; index += 1) {
    hash ^= BigInt(canonicalInput.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 1099511628211n);
  }
  return `office-v1-${hash.toString(16).padStart(16, "0")}`;
}

function minimumContentWidth(
  items: readonly OfficeContentItemLike[],
  flow: OfficeContentFlow | undefined,
  maxContentItems: number,
) {
  const { selected } = normalizeContentItems(items, maxContentItems);
  const validItems = selected.filter((item) => item.valid);
  if (validItems.length === 0) {
    return 0;
  }
  const itemWidths = validItems.map((item) => item.minWidth);
  if (flow === "row") {
    return (
      itemWidths.reduce((total, width) => total + width, 0) +
      Math.max(0, itemWidths.length - 1) * 8
    );
  }
  return Math.max(...itemWidths);
}

function normalizeCapacity(value: number | undefined, fallback: number) {
  const numeric =
    typeof value === "number" && Number.isFinite(value)
      ? Math.floor(value)
      : fallback;
  return Math.max(1, Math.min(DEFAULT_MAX_CONTENT_ITEMS, numeric));
}

function importanceRank(value: OfficeContentImportance) {
  return value === "required" ? 0 : value === "preferred" ? 1 : 2;
}

function isImportance(value: string): value is OfficeContentImportance {
  return value === "required" || value === "preferred" || value === "optional";
}

function compactOfficeLabel(value: string, limit: number) {
  return fitOfficeLabel(value, measureOfficeText(value.slice(0, limit)), limit);
}

function fitOfficeLabel(
  value: string,
  maximumWidth: number,
  fallbackLimit = 256,
) {
  const points = [...value];
  if (maximumWidth <= 0) {
    return "";
  }
  if (points.length === 0 || measureOfficeText(value) <= maximumWidth) {
    return value;
  }
  const ellipsis = "…";
  if (measureOfficeText(ellipsis) > maximumWidth) {
    return "";
  }
  let end = Math.max(1, Math.min(points.length, fallbackLimit));
  while (
    end > 1 &&
    measureOfficeText(`${points.slice(0, end).join("")}${ellipsis}`) >
      maximumWidth
  ) {
    end -= 1;
  }
  if (measureOfficeText(`${points[0]}${ellipsis}`) > maximumWidth) {
    return ellipsis;
  }
  return `${points.slice(0, end).join("")}${ellipsis}`;
}

function measureOfficeText(value: string) {
  // Room headings are rendered uppercase by Pixi. Measure that presentation
  // form so the geometry reserves the same width the canvas actually uses.
  return [...value.toUpperCase()].reduce((width, character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const wide = codePoint > 0x2e80 || codePoint >= 0x1f000;
    return width + (wide ? 13 : character === " " ? 4 : 8.1);
  }, 0);
}
