import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { hostStore } from "./hostStore";

test.describe.configure({ timeout: 90_000 });

test.beforeEach(async ({ page, request }) => {
  await request.post("http://127.0.0.1:4173/__fixture/reset");
  await page.addInitScript((store) => {
    localStorage.setItem("herdrWeb.bridgeBackends.v2", JSON.stringify(store));
  }, hostStore());
});

test("makes Office canonical, preserves aliases, and restores theme/surface history", async ({ page }) => {
  const sockets: string[] = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  await page.goto("/");
  await waitForOffice(page);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("group", { name: "Primary navigation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Office", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Choose World theme" })).toHaveAttribute(
    "aria-expanded", "false",
  );
  const initialCoreSockets = coreSockets(sockets).length;

  await selectTheme(page, "Graph");
  await waitForGraph(page);
  await expect(page).toHaveURL(/\/?theme=graph$/);
  await expect(page.getByRole("complementary", { name: "Graph semantic view" })).toBeVisible();
  expect(coreSockets(sockets)).toHaveLength(initialCoreSockets);

  await page.getByRole("button", { name: "Spaces", exact: true }).click();
  await expect(page).toHaveURL(/\/spaces$/);
  await expect(page.locator("canvas[data-graph-canvas='true']")).toHaveCount(0);
  expect(coreSockets(sockets)).toHaveLength(initialCoreSockets);

  await page.goBack();
  await waitForGraph(page);
  await expect(page).toHaveURL(/\/?theme=graph$/);
  await page.goBack();
  await waitForOffice(page);
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/world?theme=graph");
  await waitForGraph(page);
  await expect(page).toHaveURL(/\/?theme=graph$/);
  await page.goto("/?theme=mindcraft");
  await waitForOffice(page);
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/?theme=graph");
  await waitForGraph(page);
  await page.reload();
  await waitForGraph(page);
  await expect(page).toHaveURL(/\/?theme=graph$/);

  await page.goto("/spaces");
  await expect(page).toHaveURL(/\/spaces$/);
  await expect(page.locator("canvas[data-office-canvas='true']")).toHaveCount(0);
  await page.reload();
  await expect(page).toHaveURL(/\/spaces$/);
  await expect(page.getByRole("button", { name: "Spaces", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("offers inspection, search, collapse, fit, and explicit Spaces handoff without accidental actions", async ({ page }) => {
  const terminalSockets: string[] = [];
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname === "/ws/terminal") terminalSockets.push(socket.url());
  });
  await page.goto("/?theme=graph");
  await waitForGraph(page);

  const search = page.getByRole("searchbox", { name: "Search Graph" });
  await search.fill("Codex A");
  await expect(page.getByText("1 matching spaces", { exact: true })).toBeVisible();
  const agent = page.locator(".graph-tree-terminal").filter({ hasText: "Codex A" });
  await agent.click();
  await expect(page.getByRole("region", { name: "Selected Graph entity" })).toContainText("Codex A");
  expect(terminalSockets).toEqual([]);
  await expect(page).toHaveURL(/\/?theme=graph$/);

  await agent.dblclick();
  const conversation = page.locator("[data-world-conversation='open']").filter({ hasText: "Codex A" });
  await expect(conversation).toBeVisible();
  await expect(page).toHaveURL(/\/?theme=graph$/);
  await expect.poll(() => terminalSockets.length).toBe(1);
  await expect.poll(() => page.evaluate(() => ({
    observer: window.__HERDR_GRAPH_RENDERER__?.activeConversationObservers ?? -1,
    links: window.__HERDR_GRAPH_RENDERER__?.conversationLinks ?? -1,
  }))).toEqual({ observer: 1, links: 1 });
  const windowId = await conversation.locator("xpath=..").getAttribute("data-window-id");
  expect(windowId).not.toBeNull();
  const connector = page.locator(
    `.graph-conversation-connectors path[data-window-id="${windowId}"]`,
  );
  await expect(connector).toHaveAttribute("d", /M .+ C .+/);
  const connectorBeforeMove = await connector.getAttribute("d");
  const header = conversation.getByRole("group", { name: "Move agent conversation" });
  const headerBox = await header.boundingBox();
  if (!headerBox) throw new Error("Graph terminal header is not measurable");
  await page.mouse.move(headerBox.x + 80, headerBox.y + headerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(headerBox.x + 130, headerBox.y + headerBox.height / 2 - 40, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => connector.getAttribute("d")).not.toBe(connectorBeforeMove);

  const slot = conversation.locator("xpath=..");
  const beforeResize = await slot.boundingBox();
  const resizeHandle = slot.getByRole("button", { name: "Resize agent conversation" });
  const resizeBox = await resizeHandle.boundingBox();
  if (!beforeResize || !resizeBox) throw new Error("Graph terminal resize handle is not measurable");
  await page.mouse.move(resizeBox.x + resizeBox.width - 6, resizeBox.y + resizeBox.height - 6);
  await page.mouse.down();
  await page.mouse.move(resizeBox.x + resizeBox.width + 74, resizeBox.y + resizeBox.height + 44, {
    steps: 4,
  });
  await page.mouse.up();
  await expect.poll(async () => (await slot.boundingBox())?.width ?? 0)
    .toBeGreaterThan(beforeResize.width + 50);

  await selectTheme(page, "Office");
  await waitForOffice(page);
  await expect(conversation).toBeVisible();
  await expect(slot.getByRole("button", { name: "Resize agent conversation" })).toBeVisible();
  await expect(page.locator(
    `.world-conversation-connector path[data-window-id="${windowId}"]`,
  ).first()).toHaveAttribute("d", /M .+ C .+/);
  expect(terminalSockets).toHaveLength(1);

  await selectTheme(page, "Graph");
  await waitForGraph(page);
  await expect(conversation).toBeVisible();
  await expect(page.locator(
    `.graph-conversation-connectors path[data-window-id="${windowId}"]`,
  )).toHaveAttribute("d", /M .+ C .+/);
  expect(terminalSockets).toHaveLength(1);

  await conversation.getByRole("button", { name: "Close agent conversation" }).click();
  await expect(conversation).toHaveCount(0);
  await expect(page.locator(`.graph-conversation-connectors path[data-window-id="${windowId}"]`))
    .toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({
    observer: window.__HERDR_GRAPH_RENDERER__?.activeConversationObservers ?? -1,
    links: window.__HERDR_GRAPH_RENDERER__?.conversationLinks ?? -1,
  }))).toEqual({ observer: 0, links: 0 });

  const collapse = page.locator(".graph-collapse").first();
  await collapse.click();
  await expect(collapse).toHaveAttribute("aria-expanded", "false");
  expect(terminalSockets).toHaveLength(1);
  await collapse.click();
  await page.getByRole("button", { name: "Fit graph", exact: true }).click();
  expect(terminalSockets).toHaveLength(1);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);

  await page.getByRole("region", { name: "Selected Graph entity" })
    .getByRole("button", { name: "Open in Spaces", exact: true })
    .click();
  await expect(page).toHaveURL(/\/spaces$/);
  await expect(page.locator(".stage-title")).toHaveText("Codex A");
});

test("identifies an attached empty shell and opens it with a node connector", async ({ page, request }) => {
  await request.post("http://127.0.0.1:4173/__fixture/state", {
    data: { hostId: "host-a", snapshotVariant: "empty-shell" },
  });
  await page.goto("/?theme=graph");
  await waitForGraph(page);

  const shell = page.locator(".graph-tree-terminal").filter({ hasText: "Shell" });
  await expect(shell.locator(".graph-terminal-identity")).toHaveAttribute("data-agent-kind", "shell");
  await expect(shell).toContainText("empty shell");
  await shell.dblclick();

  const conversation = page.locator("[data-world-conversation='open']").filter({ hasText: "Shell" });
  await expect(conversation).toContainText("shell terminal");
  const windowId = await conversation.locator("xpath=..").getAttribute("data-window-id");
  await expect(page.locator(`.graph-conversation-connectors path[data-window-id="${windowId}"]`))
    .toHaveAttribute("d", /M .+ C .+/);
});

test("fully disposes each Graph renderer and remains usable at compact width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?theme=graph");
  await waitForGraph(page);
  await expect(page.getByRole("button", { name: "Back to Herdr sidebar" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search Graph" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Graph semantic view" })).toBeAttached();

  for (let index = 0; index < 5; index += 1) {
    await page.getByRole("button", { name: "Back to Herdr sidebar" }).click();
    await selectTheme(page, "Office");
    await waitForOffice(page);
    await expect.poll(() => page.evaluate(
      () => window.__HERDR_GRAPH_RENDERER__?.activeRenderers ?? -1,
    )).toBe(0);
    await page.getByRole("button", { name: "Back to Herdr sidebar" }).click();
    await selectTheme(page, "Graph");
    await waitForGraph(page);
  }

  await page.getByRole("button", { name: "Back to Herdr sidebar" }).click();
  await page.getByRole("button", { name: "Spaces", exact: true }).click();
  await expect.poll(() => page.evaluate(
    () => window.__HERDR_GRAPH_RENDERER__?.activeRenderers ?? -1,
  )).toBe(0);
  expect(await page.evaluate(() => window.__HERDR_GRAPH_RENDERER__)).toMatchObject({
    mounts: 6,
    destroys: 6,
    activeRenderers: 0,
    activeAnimationFrames: 0,
    activeObservers: 0,
    activeConversationObservers: 0,
    activeListeners: 0,
    canvases: 0,
    ready: false,
  });
});

test("keeps bounded topology and ownership stable through a live revision soak", async ({ page, request }) => {
  test.setTimeout(120_000);
  const sockets: string[] = [];
  const pageErrors: string[] = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await request.post("http://127.0.0.1:4173/__fixture/state", {
    data: { hostId: "host-a", snapshotVariant: "large" },
  });
  await page.goto("/?theme=graph");
  await waitForGraph(page);
  await expect(page.locator(".graph-tree-space")).toHaveCount(128);
  await expect(page.locator(".graph-tree-terminal")).toHaveCount(16);
  await expect.poll(() => page.evaluate(
    () => window.__HERDR_GRAPH_RENDERER__?.activeAnimationFrames ?? -1,
  )).toBe(0);
  const initialCoreSockets = coreSockets(sockets).length;

  for (let revision = 0; revision < 24; revision += 1) {
    const snapshotVariant = revision % 2 === 0 ? "idle-desk" : "large";
    await setSnapshotVariant(request, snapshotVariant);
    await publishSnapshotChanged(request);
    await expect.poll(() => page.evaluate(
      () => window.__HERDR_GRAPH_RENDERER__?.nodes ?? -1,
    )).toBe(144);

    if (revision % 6 === 5) {
      await setSnapshotVariant(request, "empty");
      await publishSnapshotChanged(request);
      await expect.poll(() => page.evaluate(
        () => window.__HERDR_GRAPH_RENDERER__?.nodes ?? -1,
      )).toBe(0);
      await setSnapshotVariant(request, "large");
      await publishSnapshotChanged(request);
      await expect.poll(() => page.evaluate(
        () => window.__HERDR_GRAPH_RENDERER__?.nodes ?? -1,
      )).toBe(144);
    }
  }

  await expect.poll(() => page.evaluate(
    () => window.__HERDR_GRAPH_RENDERER__?.activeAnimationFrames ?? -1,
  )).toBe(0);
  expect(await page.evaluate(() => window.__HERDR_GRAPH_RENDERER__)).toMatchObject({
    mounts: 1,
    destroys: 0,
    activeRenderers: 1,
    activeAnimationFrames: 0,
    activeObservers: 1,
    activeListeners: 7,
    canvases: 1,
    nodes: 144,
    links: 16,
    ready: true,
  });
  expect(coreSockets(sockets)).toHaveLength(initialCoreSockets);
  expect(sockets.filter((value) => new URL(value).pathname === "/ws/terminal")).toEqual([]);
  expect(pageErrors).toEqual([]);
});

async function selectTheme(page: Page, label: "Office" | "Graph") {
  const trigger = page.locator(".world-theme-menu-trigger");
  await trigger.click();
  await page.getByRole("menu", { name: "World themes" })
    .getByRole("menuitemradio", { name: label, exact: true })
    .click();
}

async function waitForOffice(page: Page) {
  await expect(page.locator("canvas[data-office-canvas='true']")).toHaveCount(1);
  await expect.poll(() => page.evaluate(
    () => window.__HERDR_WORLD_RENDERER__?.ready ?? false,
  )).toBe(true);
}

async function waitForGraph(page: Page) {
  await expect(page.locator("canvas[data-graph-canvas='true']")).toHaveCount(1);
  await expect.poll(() => page.evaluate(
    () => window.__HERDR_GRAPH_RENDERER__?.ready ?? false,
  )).toBe(true);
}

function coreSockets(urls: readonly string[]) {
  return urls.filter((value) => {
    const path = new URL(value).pathname;
    return path === "/ws/activity" || path === "/ws/events" || path === "/ws/ui-events";
  });
}

async function setSnapshotVariant(
  request: import("@playwright/test").APIRequestContext,
  snapshotVariant: "empty" | "empty-shell" | "idle-desk" | "large",
) {
  const response = await request.post("http://127.0.0.1:4173/__fixture/state", {
    data: { hostId: "host-a", snapshotVariant },
  });
  expect(response.ok()).toBe(true);
}

async function publishSnapshotChanged(request: import("@playwright/test").APIRequestContext) {
  const response = await request.post("http://127.0.0.1:4173/__fixture/ws-event", {
    data: {
      hostId: "host-a",
      path: "/ws/events",
      event: { type: "snapshot_changed" },
    },
  });
  expect(response.ok()).toBe(true);
  expect((await response.json()).sent).toBeGreaterThan(0);
}
