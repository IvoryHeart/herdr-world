import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { hostStore } from "./hostStore";

const evidenceDir = resolve("docs/evidence/spec-018");

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

test.beforeEach(async ({ page, request }) => {
  await request.post("http://127.0.0.1:4173/__fixture/reset");
  await page.addInitScript((store) => {
    localStorage.setItem("herdrWeb.bridgeBackends.v2", JSON.stringify(store));
  }, hostStore());
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "compact", width: 390, height: 844 },
] as const) {
  test(`captures the deterministic Graph ${viewport.name} view`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/?theme=graph");
    await waitForSettledGraph(page);
    await page.getByRole("button", { name: "Fit graph", exact: true }).click();
    await expect.poll(() => page.evaluate(
      () => window.__HERDR_GRAPH_RENDERER__?.activeAnimationFrames ?? -1,
    )).toBe(0);
    await page.screenshot({
      path: resolve(evidenceDir, `graph-${viewport.width}x${viewport.height}.png`),
      fullPage: viewport.name === "compact",
    });
  });
}

async function waitForSettledGraph(page: Page) {
  await expect(page.locator("canvas[data-graph-canvas='true']")).toHaveCount(1);
  await expect.poll(() => page.evaluate(
    () => window.__HERDR_GRAPH_RENDERER__?.ready ?? false,
  )).toBe(true);
  await expect.poll(() => page.evaluate(
    () => window.__HERDR_GRAPH_RENDERER__?.activeAnimationFrames ?? -1,
  )).toBe(0);
}
