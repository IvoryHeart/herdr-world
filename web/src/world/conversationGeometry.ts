export type ConversationGeometry = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export const CONVERSATION_STAGE_MARGIN = 12;
export const CONVERSATION_MIN_WIDTH = 560;
export const CONVERSATION_MIN_HEIGHT = 340;
export const CONVERSATION_DEFAULT_MAX_WIDTH = 960;
export const CONVERSATION_DEFAULT_MAX_HEIGHT = 560;
const LEGACY_GRAPH_CONVERSATION_MAX_WIDTH = 720;
const LEGACY_GRAPH_CONVERSATION_MAX_HEIGHT = 430;

export function defaultConversationGeometry(
  viewportWidth: number,
  viewportHeight: number,
): ConversationGeometry {
  const width = boundedDimension(
    viewportWidth * 0.72,
    CONVERSATION_MIN_WIDTH,
    CONVERSATION_DEFAULT_MAX_WIDTH,
    viewportWidth,
  );
  const height = boundedDimension(
    viewportHeight * 0.6,
    CONVERSATION_MIN_HEIGHT,
    CONVERSATION_DEFAULT_MAX_HEIGHT,
    viewportHeight,
  );
  return clampConversationGeometry({
    left: (viewportWidth - width) / 2,
    top: (viewportHeight - height) / 2,
    width,
    height,
  }, viewportWidth, viewportHeight);
}

export function defaultGraphConversationGeometry(
  viewportWidth: number,
  viewportHeight: number,
): ConversationGeometry {
  const { width, height } = defaultConversationGeometry(viewportWidth, viewportHeight);
  return clampConversationGeometry({
    left: viewportWidth - CONVERSATION_STAGE_MARGIN - width,
    top: viewportHeight - CONVERSATION_STAGE_MARGIN - height,
    width,
    height,
  }, viewportWidth, viewportHeight);
}

export function isLegacyDefaultGraphConversationGeometry(
  geometry: ConversationGeometry,
  viewportWidth: number,
  viewportHeight: number,
  index: number,
) {
  const width = boundedDimension(
    viewportWidth * 0.52,
    CONVERSATION_MIN_WIDTH,
    LEGACY_GRAPH_CONVERSATION_MAX_WIDTH,
    viewportWidth,
  );
  const height = boundedDimension(
    viewportHeight * 0.48,
    CONVERSATION_MIN_HEIGHT,
    LEGACY_GRAPH_CONVERSATION_MAX_HEIGHT,
    viewportHeight,
  );
  const legacy = clampConversationGeometry({
    left: viewportWidth - CONVERSATION_STAGE_MARGIN - width - index * 34,
    top: viewportHeight - CONVERSATION_STAGE_MARGIN - height - index * 28,
    width,
    height,
  }, viewportWidth, viewportHeight);
  return Math.abs(geometry.left - legacy.left) < 1 &&
    Math.abs(geometry.top - legacy.top) < 1 &&
    Math.abs(geometry.width - legacy.width) < 1 &&
    Math.abs(geometry.height - legacy.height) < 1;
}

export function clampConversationGeometry(
  geometry: ConversationGeometry,
  viewportWidth: number,
  viewportHeight: number,
): ConversationGeometry {
  const maxWidth = Math.max(0, viewportWidth - CONVERSATION_STAGE_MARGIN * 2);
  const maxHeight = Math.max(0, viewportHeight - CONVERSATION_STAGE_MARGIN * 2);
  const minWidth = Math.min(CONVERSATION_MIN_WIDTH, maxWidth);
  const minHeight = Math.min(CONVERSATION_MIN_HEIGHT, maxHeight);
  const width = clamp(
    finiteOr(geometry.width, minWidth),
    minWidth,
    maxWidth,
  );
  const height = clamp(
    finiteOr(geometry.height, minHeight),
    minHeight,
    maxHeight,
  );
  const maxLeft = Math.max(CONVERSATION_STAGE_MARGIN, viewportWidth - CONVERSATION_STAGE_MARGIN - width);
  const maxTop = Math.max(CONVERSATION_STAGE_MARGIN, viewportHeight - CONVERSATION_STAGE_MARGIN - height);
  return {
    left: clamp(finiteOr(geometry.left, CONVERSATION_STAGE_MARGIN), CONVERSATION_STAGE_MARGIN, maxLeft),
    top: clamp(finiteOr(geometry.top, CONVERSATION_STAGE_MARGIN), CONVERSATION_STAGE_MARGIN, maxTop),
    width,
    height,
  };
}

export function moveConversationGeometry(
  geometry: ConversationGeometry,
  deltaX: number,
  deltaY: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  return clampConversationGeometry({
    ...geometry,
    left: geometry.left + deltaX,
    top: geometry.top + deltaY,
  }, viewportWidth, viewportHeight);
}

export function resizeConversationGeometry(
  geometry: ConversationGeometry,
  deltaWidth: number,
  deltaHeight: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  return clampConversationGeometry({
    ...geometry,
    width: geometry.width + deltaWidth,
    height: geometry.height + deltaHeight,
  }, viewportWidth, viewportHeight);
}

function boundedDimension(value: number, minimum: number, maximum: number, viewport: number) {
  const available = Math.max(0, viewport - CONVERSATION_STAGE_MARGIN * 2);
  return clamp(value, Math.min(minimum, available), Math.min(maximum, available));
}

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
