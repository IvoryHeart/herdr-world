import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { hostStore } from "./hostStore";
import { selectView } from "./sidebarControls";

test.beforeEach(async ({ page, request }) => {
  await request.post("http://127.0.0.1:4173/__fixture/reset");
  await page.addInitScript((store) => {
    localStorage.setItem("herdrWeb.bridgeBackends.v2", JSON.stringify(store));
    localStorage.removeItem("herdr.world.tree-view.v1");
  }, hostStore());
});

test("keeps all shared views and Tree in canonical browser history", async ({ page }) => {
  await page.goto("/?theme=tree");
  const viewPicker = page.getByRole("combobox", { name: "View", exact: true });
  await expect(viewPicker).toHaveValue("tree");
  await expect(viewPicker.locator("option")).toHaveCount(4);
  await expect(viewPicker.locator("option").allTextContents()).resolves.toEqual([
    "Office", "Tree", "Graph", "Spaces",
  ]);

  await viewPicker.selectOption("graph");
  await expect(page).toHaveURL(/\/?theme=graph$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/?theme=tree$/);
  await expect(viewPicker).toHaveValue("tree");
});

test("routes to the accessible Tree and keeps selection separate from activation", async ({ page }) => {
  const terminalSockets: string[] = [];
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname === "/ws/terminal") terminalSockets.push(socket.url());
  });
  await page.goto("/?theme=tree");
  await expect(page).toHaveURL(/\/?theme=tree$/);
  await expect(page.getByRole("combobox", { name: "View", exact: true })).toHaveValue("tree");

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
  await selectView(page, "Graph");
  await expect(page.locator("canvas[data-graph-canvas='true']")).toHaveCount(1);
  await expect(conversation).toBeVisible();
  await selectView(page, "Tree");
  await expect(conversation).toBeVisible();
  expect(terminalSockets).toHaveLength(1);

  await search.fill("not present anywhere");
  await expect(semantic.getByText("No Tree matches", { exact: true })).toBeVisible();
});

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
  for (let index = 0; index < 12; index += 1) await page.getByRole("button", { name: "Zoom in" }).click();

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

  await selectView(page, "Graph");
  await selectView(page, "Tree");
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

test("keeps dense unequal branches readable with attached connectors and a persistent inspector", async ({ page, request }) => {
  await request.post("http://127.0.0.1:4173/__fixture/state", {
    data: { hostId: "host-a", snapshotVariant: "showcase" },
  });
  await page.addInitScript(() => localStorage.setItem("herdrWeb.bridgeBackends.v2", JSON.stringify({
    version: 2, enabledBridgeIds: ["same-origin"], lastSelectedBridgeId: "same-origin", backends: [],
  })));
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/?theme=tree");
  await expect(page.locator(".tree-visual-leaves .tree-card")).toHaveCount(11);
  await expect(page.getByRole("combobox", { name: "View", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Tree inspector", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Fit tree" }).click();
  expect((await treeCamera(page)).zoom).toBeGreaterThanOrEqual(0.9);
  await expectDenseCardsInsideViewport(page);
  await expectAttachedTreeConnectors(page);
  await captureTree(page, "desktop-overview-1536.png");

  const card = page.locator(".tree-card").filter({ has: page.getByText("Codex Build", { exact: true }) });
  await card.click();
  await expect(card).toHaveAttribute("data-selected", "true");
  await expect(page.getByRole("region", { name: "Selected Tree entity" })).toContainText("Codex Build");
  await expect(page.getByRole("region", { name: "Tree operational overview" })).toContainText("11 of 11 observed leaves");
  await expect(page.locator("[data-world-conversation='open']")).toHaveCount(0);
  await captureTree(page, "desktop-selected-1536.png");
  for (const [width, height] of [[1440, 900], [1200, 800]]) {
    await page.setViewportSize({ width, height });
    await page.getByRole("button", { name: "Fit tree" }).click();
    expect((await treeCamera(page)).zoom).toBeGreaterThanOrEqual(width === 1440 ? 0.9 : 0.65);
    await expectDenseCardsInsideViewport(page);
    await captureTree(page, `desktop-selected-${width}.png`);
  }

  const collapse = page.getByRole("button", { name: /^Collapse Launch Control, Space/ });
  await collapse.click();
  await expect(page.locator(".tree-visual-space").first()).toHaveAttribute("data-has-children", "false");
  await expect(page.locator(".tree-visual-space").first().locator(".tree-visual-leaves")).toHaveCount(0);
  expect(await page.locator(".tree-visual-space").first().locator(":scope > .tree-card-wrap")
    .evaluate((element) => getComputedStyle(element, "::after").content)).toBe("none");
  await page.getByRole("searchbox", { name: "Search Tree" }).fill("Codex Build");
  await expect(page.locator(".tree-visual-leaves .tree-card")).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Search Tree" }).fill("");
  await expect(page.getByRole("button", { name: /^Expand Launch Control, Space/ })).toHaveAttribute("aria-expanded", "false");
  await captureTree(page, "desktop-collapsed-1200.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByRole("region", { name: "Selected Tree entity" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const results = await new AxeBuilder({ page }).include(".tree-stage-shell").analyze();
  expect(results.violations).toEqual([]);
  await captureTree(page, "phone-selected-390.png");
});

test("shows empty host identity without dangling child links", async ({ page, request }) => {
  await request.post("http://127.0.0.1:4173/__fixture/state", {
    data: { hostId: "host-a", snapshotVariant: "empty" },
  });
  await page.goto("/?theme=tree");
  const host = page.locator(".tree-visual-host").first();
  await expect(host).toHaveAttribute("data-has-children", "false");
  await expect(host.locator(".tree-visual-spaces")).toHaveCount(0);
  expect(await host.locator(":scope > .tree-card-wrap").evaluate((element) => getComputedStyle(element, "::after").content)).toBe("none");
  await expect(page.getByText("No observed spaces").first()).toBeVisible();
  await page.getByRole("button", { name: /^Hosts:/ }).click();
  await page.getByRole("menuitemradio", { name: /Offline E/ }).click();
  await expect(page.locator('.tree-card-wrap[data-state="disconnected"]').first()).toBeVisible();
});

async function captureTree(page: import("@playwright/test").Page, name: string) {
  if (process.env.TREE_CAPTURE_EVIDENCE === "1") {
    await page.screenshot({ path: `docs/evidence/tree-operations-console/${name}` });
  }
}

async function expectDenseCardsInsideViewport(page: import("@playwright/test").Page) {
  await expect.poll(async () => page.locator(".tree-viewport").evaluate((element) => {
    const viewport = element.getBoundingClientRect();
    return [...element.querySelectorAll(".tree-card")].map((card) => {
      const box = card.getBoundingClientRect();
      return box.left >= viewport.left && box.right <= viewport.right && box.top >= viewport.top && box.bottom <= viewport.bottom;
    });
  })).toEqual(Array(16).fill(true));
}

async function expectAttachedTreeConnectors(page: import("@playwright/test").Page) {
  const endpoints = await page.locator(".tree-visual-host").evaluate((host) => {
    const root = host.querySelector<HTMLElement>(":scope > .tree-card-wrap")!;
    const spaces = [...host.querySelectorAll<HTMLElement>(".tree-visual-space")];
    const hostCenter = root.offsetLeft + root.offsetWidth / 2;
    const first = spaces[0];
    const last = spaces.at(-1)!;
    const group = host.querySelector<HTMLElement>(".tree-visual-spaces")!;
    const centers = spaces.map((space) => space.offsetLeft + space.offsetWidth / 2);
    const busEnds = spaces.slice(0, -1).map((space) => {
      const bus = getComputedStyle(space, "::after");
      return space.offsetLeft + parseFloat(bus.left) + parseFloat(bus.width);
    });
    return {
      hostCenter, branchCenter: group.offsetLeft + (first.offsetLeft + first.offsetWidth / 2 + last.offsetLeft + last.offsetWidth / 2) / 2,
      centers: centers.slice(1), busEnds,
      leafConnections: spaces.flatMap((space) => [...space.querySelectorAll<HTMLElement>(".tree-visual-leaves > .tree-card-wrap")].map((leaf) => {
        const link = getComputedStyle(leaf, "::before");
        return { end: parseFloat(link.left) + parseFloat(link.width), center: parseFloat(link.top), height: leaf.offsetHeight };
      })),
    };
  });
  expect(endpoints.hostCenter).toBeCloseTo(endpoints.branchCenter, 0);
  expect(endpoints.busEnds).toEqual(endpoints.centers);
  for (const leaf of endpoints.leafConnections) {
    expect(leaf.end).toBe(0);
    expect(leaf.center).toBeCloseTo(leaf.height / 2, 0);
  }
}

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
