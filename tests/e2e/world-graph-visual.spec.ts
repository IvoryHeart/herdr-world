import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

import {
  expectGraphConnectorOutsideOverlay,
  waitForStableConversationRect,
} from "./graphConnector";
import { hostStore } from "./hostStore";

const evidenceDir = resolve("docs/evidence/spec-018");

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

test.beforeEach(async ({ page, request }) => {
  await request.post("http://127.0.0.1:4173/__fixture/reset");
  await page.addInitScript((store) => {
    localStorage.setItem("herdrWeb.bridgeBackends.v2", JSON.stringify(store));
    localStorage.removeItem("herdr.world.graph-view.v1");
    localStorage.removeItem("herdrWeb.worldView.v1");
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

test("captures the connected Graph terminal overlay", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?theme=graph");
  await waitForSettledGraph(page);
  await page.getByRole("button", { name: "Fit graph", exact: true }).click();
  await page.locator(".graph-tree-terminal").filter({ hasText: "Codex A" }).dblclick();
  await expect(page.locator("[data-world-conversation='open']")).toBeVisible();
  await expect(page.locator(".graph-conversation-connectors path")).toHaveAttribute("d", /M .+ C .+/);
  const windowId = await page.locator(".world-conversation-slot").getAttribute("data-window-id");
  if (!windowId) throw new Error("Graph terminal window ID is unavailable");
  await waitForStableConversationRect(page, windowId);
  await expectGraphConnectorOutsideOverlay(page, windowId);
  await page.getByRole("button", { name: "Fit graph", exact: true }).click();
  await expect.poll(() => page.evaluate(
    () => window.__HERDR_GRAPH_RENDERER__?.activeAnimationFrames ?? -1,
  )).toBe(0);
  await waitForStableConversationRect(page, windowId);
  await expectGraphConnectorOutsideOverlay(page, windowId);
  await page.screenshot({
    path: resolve(evidenceDir, "graph-terminal-1440x900.png"),
    animations: "disabled",
  });
});

test("captures the compact empty-shell identity and connected terminal", async ({ page, request }) => {
  await request.post("http://127.0.0.1:4173/__fixture/state", {
    data: { hostId: "host-a", snapshotVariant: "empty-shell" },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?theme=graph");
  await waitForSettledGraph(page);
  await page.getByRole("button", { name: "Fit graph", exact: true }).click();
  const shell = page.locator(".graph-tree-terminal").filter({ hasText: "Shell" });
  await expect(shell.locator("[data-agent-kind='shell']")).toBeVisible();
  await shell.locator("xpath=..").getByRole("button", { name: "Open terminal", exact: true }).click();
  await expect(page.locator("[data-world-conversation='open']").filter({ hasText: "Shell" }))
    .toBeVisible();
  await expect(page.locator(".graph-conversation-connectors path")).toHaveAttribute("d", /M .+ C .+/);
  const windowId = await page.locator(".world-conversation-slot").getAttribute("data-window-id");
  if (!windowId) throw new Error("Graph shell window ID is unavailable");
  await expectGraphConnectorOutsideOverlay(page, windowId);
  await page.screenshot({
    path: resolve(evidenceDir, "graph-empty-shell-terminal-390x844.png"),
    fullPage: true,
    animations: "disabled",
  });
});

async function waitForSettledGraph(page: Page) {
  await expect(page.locator("canvas[data-graph-canvas='true']")).toHaveCount(1);
  await expect.poll(() => page.evaluate(
    () => window.__HERDR_GRAPH_RENDERER__?.ready ?? false,
  )).toBe(true);
  await expect.poll(() => page.evaluate(
    () => window.__HERDR_GRAPH_RENDERER__?.activeAnimationFrames ?? -1,
  )).toBe(0);
}
