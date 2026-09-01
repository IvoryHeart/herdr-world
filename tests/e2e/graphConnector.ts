import { expect, type Page } from "@playwright/test";

export async function expectGraphConnectorOutsideOverlay(page: Page, windowId: string) {
  const metrics = await page.evaluate((id) => {
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
  }, windowId);

  expect(metrics).not.toBeNull();
  expect(metrics?.pathLength).toBeGreaterThan(24);
  expect(metrics?.sourceDistanceFromOverlay, JSON.stringify(metrics)).toBeGreaterThan(24);
}
