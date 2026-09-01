import { expect, type Page } from "@playwright/test";

export async function expectGraphConnectorOutsideOverlay(page: Page, windowId: string) {
  let metrics: GraphConnectorMetrics | null = null;
  await expect.poll(async () => {
    metrics = await graphConnectorMetrics(page, windowId);
    return Math.min(
      metrics?.pathLength ?? -1,
      metrics?.sourceDistanceFromOverlay ?? -1,
    );
  }, {
    message: `Graph connector ${windowId} should remain visible outside its overlay`,
  }).toBeGreaterThan(24);

  expect(metrics).not.toBeNull();
  expect(metrics?.pathLength, JSON.stringify(metrics)).toBeGreaterThan(24);
  expect(metrics?.sourceDistanceFromOverlay, JSON.stringify(metrics)).toBeGreaterThan(24);
}

export async function waitForStableConversationRect(page: Page, windowId: string) {
  const slot = page.locator(`.world-conversation-slot[data-window-id="${windowId}"]`);
  let previous: Awaited<ReturnType<typeof slot.boundingBox>> = null;
  let stableSamples = 0;
  await expect.poll(async () => {
    const positioned = await slot.getAttribute("data-positioned");
    const current = await slot.boundingBox();
    if (!current || positioned !== "true") {
      previous = current;
      stableSamples = 0;
      return stableSamples;
    }
    if (previous && boundingBoxesMatch(previous, current)) stableSamples += 1;
    else stableSamples = 0;
    previous = current;
    return stableSamples;
  }, {
    intervals: [50, 50, 100, 100, 200],
    message: `Conversation window ${windowId} should reach stable positioned geometry`,
  }).toBeGreaterThanOrEqual(2);
  return previous;
}

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

function boundingBoxesMatch(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) {
  return Math.abs(left.x - right.x) < 0.5 &&
    Math.abs(left.y - right.y) < 0.5 &&
    Math.abs(left.width - right.width) < 0.5 &&
    Math.abs(left.height - right.height) < 0.5;
}
