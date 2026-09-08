import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { hostStore } from "./hostStore";

test.beforeEach(async ({ page, request }) => {
  await request.post("http://127.0.0.1:4173/__fixture/reset");
  await page.addInitScript((store) => {
    localStorage.setItem("herdrWeb.bridgeBackends.v2", JSON.stringify(store));
    localStorage.removeItem("herdr.world.tree-view.v1");
  }, hostStore());
});

test("routes to the accessible Tree and keeps selection separate from activation", async ({ page }) => {
  const terminalSockets: string[] = [];
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname === "/ws/terminal") terminalSockets.push(socket.url());
  });
  await page.goto("/?theme=tree");
  await expect(page).toHaveURL(/\/?theme=tree$/);
  await expect(page.getByRole("button", { name: "Tree", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Choose World theme" }).click();
  await expect(page.getByRole("menuitemradio")).toHaveCount(3);
  await expect(page.getByRole("menuitemradio", { name: "Tree", exact: true })).toHaveCount(1);
  await page.keyboard.press("Escape");

  const search = page.getByRole("searchbox", { name: "Search Tree" });
  await expect(page.locator(".tree-map")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator(".tree-map button")).toHaveCount(0);
  await search.fill("Codex A");
  const semantic = page.getByRole("complementary", { name: "Tree details and semantic hierarchy" });
  const agent = semantic.getByRole("button", { name: /Codex A.*Agent.*working/i }).first();
  await expect(agent).toBeVisible();
  await agent.click();
  await expect(page.getByRole("region", { name: "Selected Tree entity" })).toContainText("Codex A");
  expect(terminalSockets).toEqual([]);
  await expect(page.getByRole("region", { name: "Selected Tree entity" }).getByRole("button", { name: "Open terminal" })).toBeVisible();
  await page.getByRole("region", { name: "Selected Tree entity" })
    .getByRole("button", { name: "Open terminal" }).click();
  const conversation = page.locator("[data-world-conversation='open']").filter({ hasText: "Codex A" });
  await expect(conversation).toBeVisible();
  await expect.poll(() => terminalSockets.length).toBe(1);
  await selectTheme(page, "Graph");
  await expect(page.locator("canvas[data-graph-canvas='true']")).toHaveCount(1);
  await expect(conversation).toBeVisible();
  await selectTheme(page, "Tree");
  await expect(conversation).toBeVisible();
  expect(terminalSockets).toHaveLength(1);

  await search.fill("not present anywhere");
  await expect(semantic.getByText("No Tree matches", { exact: true })).toBeVisible();
});

async function selectTheme(page: import("@playwright/test").Page, label: "Tree" | "Graph") {
  await page.getByRole("button", { name: "Choose World theme" }).click();
  await page.getByRole("menu", { name: "World themes" })
    .getByRole("menuitemradio", { name: label, exact: true }).click();
}

test("keeps Tree camera/collapse isolated and exposes the semantic hierarchy at compact width", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("herdr.world.graph-view.v2", JSON.stringify({ marker: "unchanged" }));
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?theme=tree");
  await expect(page.locator(".tree-viewport")).toBeHidden();
  const semantic = page.getByRole("complementary", { name: "Tree details and semantic hierarchy" });
  await expect(semantic.getByRole("list", { name: "Presented hosts, spaces, agents, and terminals" })).toBeVisible();
  const disclosure = semantic.locator(".tree-disclosure").first();
  await disclosure.focus();
  await page.keyboard.press("Enter");
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await page.waitForTimeout(160);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("herdr.world.graph-view.v2") ?? "null")))
    .toEqual({ marker: "unchanged" });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("herdr.world.tree-view.v1") ?? "null")))
    .toMatchObject({ collapsedIds: [expect.any(String)] });

  const search = page.getByRole("searchbox", { name: "Search Tree" });
  await search.fill("Codex A");
  await expect(disclosure).toBeDisabled();
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect(disclosure).toHaveAccessibleName(/expanded for search$/);
  await disclosure.click({ force: true });
  await search.fill("");
  await expect(disclosure).toBeEnabled();
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");

  const results = await new AxeBuilder({ page }).include(".tree-stage-shell").analyze();
  expect(results.violations).toEqual([]);
});

test("bounds and restores camera changes made through every viewport handler", async ({ page }) => {
  await page.setViewportSize({ width: 1_200, height: 800 });
  await page.goto("/?theme=tree");
  await page.evaluate(() => localStorage.setItem("herdr.world.graph-view.v2", JSON.stringify({ marker: "unchanged" })));
  const map = page.locator(".tree-map");
  const viewport = page.locator(".tree-viewport");

  await page.getByRole("button", { name: "Fit tree" }).click();
  const fitted = await treeCamera(page);
  expect(fitted.zoom).toBeGreaterThanOrEqual(0.4);
  expect(fitted.zoom).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Zoom in" }).click();
  expect((await treeCamera(page)).zoom).toBeGreaterThan(fitted.zoom);
  await page.getByRole("button", { name: "Zoom out" }).click();
  expect((await treeCamera(page)).zoom).toBeLessThan(fitted.zoom * 1.15);
  for (let index = 0; index < 30; index += 1) await page.getByRole("button", { name: "Zoom in" }).click();
  expect((await treeCamera(page)).zoom).toBe(2.5);
  for (let index = 0; index < 60; index += 1) await page.getByRole("button", { name: "Zoom out" }).click();
  expect((await treeCamera(page)).zoom).toBe(0.4);
  for (let index = 0; index < 8; index += 1) await page.getByRole("button", { name: "Zoom in" }).click();

  await viewport.hover();
  const beforeWheel = await treeCamera(page);
  await viewport.dispatchEvent("wheel", { deltaX: 120, deltaY: 90 });
  const afterWheel = await treeCamera(page);
  expect({ x: afterWheel.x, y: afterWheel.y }).not.toEqual({ x: beforeWheel.x, y: beforeWheel.y });

  await viewport.dispatchEvent("wheel", { ctrlKey: true, deltaY: -100 });
  expect((await treeCamera(page)).zoom).toBeGreaterThan(afterWheel.zoom);

  const box = await viewport.boundingBox();
  if (!box) throw new Error("Tree viewport has no pointer target");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 140, box.y + box.height / 2 + 110);
  await page.mouse.up();
  const dragged = await treeCamera(page);
  expect({ x: dragged.x, y: dragged.y }).not.toEqual({ x: afterWheel.x, y: afterWheel.y });
  await expectCameraInBounds(page);
  await page.setViewportSize({ width: 900, height: 700 });
  await page.waitForTimeout(50);
  await expectCameraInBounds(page);
  await page.setViewportSize({ width: 1_200, height: 800 });
  await page.waitForTimeout(50);
  await expectCameraInBounds(page);
  const finalCamera = await treeCamera(page);

  await page.waitForTimeout(180);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("herdr.world.tree-view.v1") ?? "null"));
  expect(saved.camera.x).toBeCloseTo(finalCamera.x, 3);
  expect(saved.camera.y).toBeCloseTo(finalCamera.y, 3);
  expect(saved.camera.zoom).toBeCloseTo(finalCamera.zoom, 3);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("herdr.world.graph-view.v2") ?? "null")))
    .toEqual({ marker: "unchanged" });

  await selectTheme(page, "Graph");
  await selectTheme(page, "Tree");
  expect(await treeCamera(page)).toEqual(finalCamera);
  const restoredPage = await page.context().newPage();
  await restoredPage.setViewportSize({ width: 1_200, height: 800 });
  await restoredPage.goto("/?theme=tree");
  expect(await treeCamera(restoredPage)).toEqual(finalCamera);
  await expectCameraInBounds(restoredPage);
  await restoredPage.close();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(map).toHaveCSS("transition-duration", "0s");
});

async function treeCamera(page: import("@playwright/test").Page) {
  return page.locator(".tree-map").evaluate((element) => {
    const match = (element as HTMLElement).style.transform.match(
      /^translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)$/,
    );
    if (!match) throw new Error(`Unexpected Tree transform: ${(element as HTMLElement).style.transform}`);
    return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
  });
}

async function expectCameraInBounds(page: import("@playwright/test").Page) {
  const result = await page.locator(".tree-viewport").evaluate((viewportElement) => {
    const viewport = viewportElement as HTMLElement;
    const map = viewport.querySelector<HTMLElement>(".tree-map");
    if (!map) throw new Error("Tree map unavailable");
    const match = map.style.transform.match(/^translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)$/);
    if (!match) throw new Error(`Unexpected Tree transform: ${map.style.transform}`);
    const [x, y, zoom] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const bounds = (viewportSize: number, mapSize: number) => {
      const scaled = mapSize * zoom;
      return scaled <= Math.max(viewportSize - 32, 0)
        ? [(viewportSize - scaled) / 2, (viewportSize - scaled) / 2]
        : [viewportSize - scaled - 16, 16];
    };
    const [minX, maxX] = bounds(viewport.clientWidth, map.scrollWidth);
    const [minY, maxY] = bounds(viewport.clientHeight, map.scrollHeight);
    return { x, y, zoom, minX, maxX, minY, maxY };
  });
  expect(result.zoom).toBeGreaterThanOrEqual(0.4);
  expect(result.zoom).toBeLessThanOrEqual(2.5);
  expect(result.x).toBeGreaterThanOrEqual(result.minX - 0.01);
  expect(result.x).toBeLessThanOrEqual(result.maxX + 0.01);
  expect(result.y).toBeGreaterThanOrEqual(result.minY - 0.01);
  expect(result.y).toBeLessThanOrEqual(result.maxY + 0.01);
}
