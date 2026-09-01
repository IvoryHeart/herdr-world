import { expect, type Page } from "@playwright/test";

const SUSTAINED_LAYOUT_MS = 250;

export async function expectGraphConnectorOutsideOverlay(page: Page, windowId: string) {
  let metrics: GraphConnectorMetrics | null = null;
  let clearSince = 0;
  let previousOverlay: GraphConnectorMetrics["overlay"] | null = null;
  await expect.poll(async () => {
    metrics = await graphConnectorMetrics(page, windowId);
    const clearance = Math.min(
      metrics?.pathLength ?? -1,
      metrics?.sourceDistanceFromOverlay ?? -1,
    );
    const now = Date.now();
    if (
      clearance <= 24 ||
      !metrics ||
      (previousOverlay && !overlaysMatch(previousOverlay, metrics.overlay))
    ) {
      clearSince = clearance > 24 && metrics ? now : 0;
    } else if (clearSince === 0) {
      clearSince = now;
    }
    previousOverlay = metrics?.overlay ?? null;
    return clearSince === 0 ? 0 : now - clearSince;
  }, {
    intervals: [50, 50, 100, 100, 200],
    message: `Graph connector ${windowId} should remain visible outside its overlay`,
  }).toBeGreaterThanOrEqual(SUSTAINED_LAYOUT_MS);

  expect(metrics).not.toBeNull();
  expect(metrics?.pathLength, JSON.stringify(metrics)).toBeGreaterThan(24);
  expect(metrics?.sourceDistanceFromOverlay, JSON.stringify(metrics)).toBeGreaterThan(24);
}

export async function waitForStableConversationRect(page: Page, windowId: string) {
  const slot = page.locator(`.world-conversation-slot[data-window-id="${windowId}"]`);
  let previous: ConversationRectMetrics | null = null;
  let stableSince = 0;
  await expect.poll(async () => {
    const current = await slot.evaluate((element) => {
      const layer = element.closest(".world-theme-layer");
      if (!(layer instanceof HTMLElement) || !(element instanceof HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      const layerRect = layer.getBoundingClientRect();
      const desired = {
        x: layerRect.left + Number.parseFloat(element.style.left),
        y: layerRect.top + Number.parseFloat(element.style.top),
        width: Number.parseFloat(element.style.width),
        height: Number.parseFloat(element.style.height),
      };
      return {
        positioned: element.dataset.positioned === "true",
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        desired,
      };
    });
    const now = Date.now();
    if (
      !current ||
      !current.positioned ||
      !rectanglesMatch(current.rect, current.desired) ||
      (previous && !rectanglesMatch(previous.rect, current.rect))
    ) {
      previous = current;
      stableSince = current?.positioned && rectanglesMatch(current.rect, current.desired) ? now : 0;
      return 0;
    }
    if (stableSince === 0) stableSince = now;
    previous = current;
    return now - stableSince;
  }, {
    intervals: [50, 50, 100, 100, 200],
    message: `Conversation window ${windowId} should reach stable positioned geometry`,
  }).toBeGreaterThanOrEqual(SUSTAINED_LAYOUT_MS);
  return previous?.rect ?? null;
}

type ConversationRectMetrics = {
  positioned: boolean;
  rect: { x: number; y: number; width: number; height: number };
  desired: { x: number; y: number; width: number; height: number };
};

type GraphConnectorMetrics = {
  pathLength: number;
  sourceDistanceFromOverlay: number;
  source: { x: number; y: number };
  overlay: { left: number; top: number; right: number; bottom: number };
};

async function graphConnectorMetrics(page: Page, windowId: string) {
  return page.evaluate((id) => {
    const path = [...document.querySelectorAll<SVGPathElement>(
      ".graph-conversation-connectors path[data-window-id]",
    )].find((candidate) => candidate.dataset.windowId === id);
    const slot = [...document.querySelectorAll<HTMLElement>(
      ".world-conversation-slot[data-window-id]",
    )].find((candidate) => candidate.dataset.windowId === id);
    if (!path || !slot) return null;
    const matrix = path.getScreenCTM();
    if (!matrix) return null;
    const source = new DOMPoint(path.getPointAtLength(0).x, path.getPointAtLength(0).y)
      .matrixTransform(matrix);
    const overlay = slot.getBoundingClientRect();
    const outsideX = Math.max(overlay.left - source.x, 0, source.x - overlay.right);
    const outsideY = Math.max(overlay.top - source.y, 0, source.y - overlay.bottom);
    return {
      pathLength: path.getTotalLength(),
      sourceDistanceFromOverlay: Math.hypot(outsideX, outsideY),
      source: { x: source.x, y: source.y },
      overlay: {
        left: overlay.left,
        top: overlay.top,
        right: overlay.right,
        bottom: overlay.bottom,
      },
    };
  }, windowId) as Promise<GraphConnectorMetrics | null>;
}

function rectanglesMatch(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) {
  return Math.abs(left.x - right.x) < 0.5 &&
    Math.abs(left.y - right.y) < 0.5 &&
    Math.abs(left.width - right.width) < 0.5 &&
    Math.abs(left.height - right.height) < 0.5;
}

function overlaysMatch(
  left: GraphConnectorMetrics["overlay"],
  right: GraphConnectorMetrics["overlay"],
) {
  return Math.abs(left.left - right.left) < 0.5 &&
    Math.abs(left.top - right.top) < 0.5 &&
    Math.abs(left.right - right.right) < 0.5 &&
    Math.abs(left.bottom - right.bottom) < 0.5;
}
