import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  deskAnchor,
  receptionAgentAnchor,
  standingAnchor,
} from "../../web/src/world/officeGeometry";
import type { PublishedOfficeLayout } from "../../web/src/world/officeLayout";
import { hostStore } from "./hostStore";

test.describe.configure({ timeout: 90_000 });

test.beforeEach(async ({ page, request }) => {
  await request.post("http://127.0.0.1:4173/__fixture/reset");
  await page.addInitScript((store) => {
    localStorage.setItem("herdrWeb.bridgeBackends.v2", JSON.stringify(store));
  }, hostStore());
});

test("uses one persistent frame for direct World entry, history, and view switching", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/world");
  await waitForOffice(page);

  const frame = page.locator(".app");
  await expect(frame).toHaveCount(1);
  await expect(page.locator("aside.sidebar")).toHaveCount(1);
  await expect(page.locator("section.stage")).toHaveCount(1);
  await expect(page.getByRole("group", { name: "Spaces | Office" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Office", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("group", { name: "Sidebar view" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Pixel Office", exact: true })
      .getByText("Pixel Office", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "Sidebar scope" })).toBeVisible();

  await expect(page.locator(".agent-row").filter({ hasText: "Codex A" })).toBeVisible();
  await expect(page.locator(".agent-row").filter({ hasText: "Codex B" })).toHaveCount(0);
  await page.getByRole("group", { name: "Host" }).getByRole("button", { name: "All", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Host" }).getByRole("button", { name: "All", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await waitForLiveOffice(page);
  await page.getByRole("button", { name: "Remote B, compatible" }).click();
  await expect(page.locator(".agent-row").filter({ hasText: "Codex B" })).toBeVisible();
  await page.getByRole("group", { name: "Host" }).getByRole("button", { name: "All", exact: true }).click();

  await frame.evaluate((element) => element.setAttribute("data-checkpoint-frame", "stable"));
  await page.getByRole("group", { name: "Host" }).getByRole("button", { name: "All", exact: true }).click();
  await page.getByRole("button", { name: "Spaces", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("group", { name: "Sidebar view" })).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Host" })
      .getByRole("button", { name: "All", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(frame).toHaveAttribute("data-checkpoint-frame", "stable");

  await page.goBack();
  await expect(page).toHaveURL(/\/world$/);
  await waitForOffice(page);
  await expect(frame).toHaveAttribute("data-checkpoint-frame", "stable");
  await expect(page.getByRole("group", { name: "Sidebar view" })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("group", { name: "Sidebar view" })).toBeVisible();

  await page.goto("/world");
  await waitForOffice(page);
  await page.getByRole("group", { name: "Host" }).getByRole("button", { name: "All", exact: true }).click();
  await waitForLiveOffice(page);
  await page.reload();
  await waitForOffice(page);
  await expect(page.locator(".app")).toHaveCount(1);
  await expect(page.locator("canvas[data-office-canvas='true']")).toHaveCount(1);
});

test("disposes the renderer across ten switches without reconnecting core observation", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const sockets: string[] = [];
  const requests: string[] = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  page.on("request", (networkRequest) => requests.push(networkRequest.url()));

  await page.goto("/world");
  await waitForOffice(page);
  await page.getByRole("group", { name: "Host" }).getByRole("button", { name: "All", exact: true }).click();
  await waitForLiveOffice(page);
  await expect.poll(() => coreSocketUrls(sockets).length).toBeGreaterThanOrEqual(6);
  expect(terminalSocketUrls(sockets)).toEqual([]);
  const initialCoreSockets = coreSocketUrls(sockets).length;
  const initialLog = await fixtureLog(request);
  const lifecycleStartedAt = Date.now();

  const frame = page.locator(".app");
  await frame.evaluate((element) => element.setAttribute("data-lifecycle-frame", "stable"));
  for (let index = 0; index < 10; index += 1) {
    await page.getByRole("button", { name: "Spaces", exact: true }).click();
    await expect(page.locator("canvas[data-office-canvas='true']")).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => window.__HERDR_WORLD_RENDERER__?.activeApplications ?? 0))
      .toBe(0);
    await page.getByRole("button", { name: "Office", exact: true }).click();
    await waitForOffice(page);
    await expect(frame).toHaveAttribute("data-lifecycle-frame", "stable");
  }

  expect(coreSocketUrls(sockets)).toHaveLength(initialCoreSockets);
  const terminalBeforeWorldIdle = terminalSocketUrls(sockets).length;
  await page.waitForTimeout(350);
  expect(terminalSocketUrls(sockets)).toHaveLength(terminalBeforeWorldIdle);
  const currentLog = await fixtureLog(request);
  const periodicRefreshBound =
    Math.ceil((Date.now() - lifecycleStartedAt) / CORE_SNAPSHOT_REFRESH_INTERVAL_MS) + 1;
  expect(currentLog.snapshotRequests - initialLog.snapshotRequests)
    .toBeLessThanOrEqual(periodicRefreshBound);
  expect(currentLog.capabilityRequests).toBe(initialLog.capabilityRequests);

  const diagnostics = await page.evaluate(() => window.__HERDR_WORLD_RENDERER__);
  expect(diagnostics).toMatchObject({
    mounts: 11,
    destroys: 10,
    activeApplications: 1,
    activeTickers: 1,
    activeObservers: 1,
    activeListeners: 6,
    canvases: 1,
    ready: true,
  });

  await page.getByRole("button", { name: "Spaces", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__HERDR_WORLD_RENDERER__?.activeApplications ?? -1))
    .toBe(0);
  expect(await page.evaluate(() => window.__HERDR_WORLD_RENDERER__)).toMatchObject({
    mounts: 11,
    destroys: 11,
    activeApplications: 0,
    activeTickers: 0,
    activeObservers: 0,
    activeListeners: 0,
    canvases: 0,
    ready: false,
  });

  const appOrigin = new URL(page.url()).origin;
  const allowedOrigins = new Set([
    appOrigin,
    ...hostStore().backends.map(({ baseUrl }) => new URL(baseUrl).origin),
  ]);
  expect(
    requests.filter((url) => {
      try {
        return !allowedOrigins.has(new URL(url).origin);
      } catch {
        return true;
      }
    }),
  ).toEqual([]);
});

test("keeps the semantic view usable with reduced motion and renderer failure", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/world");
  await waitForOffice(page);
  await page.getByRole("group", { name: "Host" }).getByRole("button", { name: "All", exact: true }).click();
  await waitForLiveOffice(page);
  expect(await page.evaluate(() => window.__HERDR_WORLD_RENDERER__)).toMatchObject({
    reducedMotion: true,
    animation: { characters: 1, monitors: 1, statuses: 1 },
  });
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  await expect.poll(() => page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(2);
  await expect(page.getByRole("group", { name: "Spaces | Office" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Sidebar view" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Sidebar scope" })).toBeVisible();
  const zoomAccessibility = await new AxeBuilder({ page }).analyze();
  expect(
    zoomAccessibility.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });

  await page.addInitScript(() => {
    window.__HERDR_WORLD_FORCE_RENDERER_FAILURE__ = true;
  });
  await page.reload();
  await expect(page.getByText("Visual scene unavailable", { exact: true })).toBeVisible();
  await waitForLiveOffice(page);
  await expect(page.getByRole("group", { name: "Sidebar view" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Host" })).toBeVisible();
  await expect(page.getByRole("button", { name: "localhost, compatible" })).toBeEnabled();
  await expect(page.locator("canvas[data-office-canvas='true']")).toHaveCount(0);
});

test("uses stage-first compact navigation and horizontal office scrolling at 375px", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/world");
  await waitForOffice(page);
  await expect(page.getByRole("button", { name: "Back to Herdr sidebar" })).toBeVisible();
  const targetChooser = page.locator(".world-compact-target-chooser > summary");
  await expect(targetChooser).toBeVisible();
  expect((await targetChooser.boundingBox())?.height).toBeGreaterThanOrEqual(48);
  const sceneTargets = page.locator(".world-semantic-target");
  await expect(sceneTargets.first()).toBeEnabled();
  expect(await sceneTargets.evaluateAll((targets) => targets.every((target) => {
    const rect = target.getBoundingClientRect();
    return rect.width >= 48 && rect.height >= 48 && Boolean(target.getAttribute("aria-label"));
  }))).toBe(true);
  await targetChooser.click();
  const compactAgent = page.locator(".world-compact-target-select").filter({ hasText: "Codex A" });
  await expect(compactAgent).toBeVisible();
  const compactAgentBox = await compactAgent.boundingBox();
  expect(compactAgentBox?.width).toBeGreaterThanOrEqual(48);
  expect(compactAgentBox?.height).toBeGreaterThanOrEqual(48);
  await compactAgent.click();
  await expect(compactAgent).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      page.locator(".world-stage-scroll").evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      })),
    )
    .toMatchObject({ clientWidth: 375 });
  await expect
    .poll(() => page.locator(".world-stage-scroll").evaluate((element) => element.scrollWidth))
    .toBeGreaterThan(375);

  await page.getByRole("button", { name: "Back to Herdr sidebar" }).click();
  await page.getByRole("group", { name: "Host" }).getByRole("button", { name: "All", exact: true }).click();
  await expect(page.getByRole("button", { name: "Office", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Sidebar view" })).toBeVisible();
  await waitForLiveOffice(page);
  const room = page.locator(".space-row").first();
  await room.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(room).toBeFocused();
  expect(await room.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
  await page.getByRole("button", { name: "Office", exact: true }).click();
  await expect(page.getByRole("button", { name: "Back to Herdr sidebar" })).toBeVisible();
});

test("opens one stable live conversation bubble for the selected Office agent", async ({
  page,
}) => {
  await page.goto("/world");
  await waitForOffice(page);
  await page.getByRole("group", { name: "Host" }).getByRole("button", { name: "All", exact: true }).click();
  await waitForLiveOffice(page);

  const bubble = page.locator("[data-world-conversation='open']");
  const firstAgent = page.locator(".agent-row").filter({ hasText: "Codex A" });
  await firstAgent.click();
  await expect(bubble).toBeVisible();
  await expect(bubble).toHaveAttribute("data-agent-key", /.+/);
  await expect(bubble.getByRole("button", { name: "Close agent conversation" })).toBeVisible();
  await expect(bubble.locator(".world-conversation-context")).toContainText("working");
  await expect(
    bubble.getByRole("button", { name: "Open full terminal in Spaces" }),
  ).toBeVisible();
  await expect(bubble.locator(".terminal-stage")).toBeVisible();
  const connector = page.locator(".world-conversation-connector");
  await expect(connector).toBeVisible();
  await expect(connector.locator("path[data-anchor='workbench']")).toHaveCount(1);
  await expect(connector.locator("path[data-anchor='agent']")).toHaveCount(1);

  const slot = page.locator(".world-conversation-slot").first();
  const before = await slot.boundingBox();
  expect(before).not.toBeNull();
  const stageBox = await page.locator(".world-stage-shell").boundingBox();
  expect(stageBox).not.toBeNull();
  expect(before?.width ?? 0).toBeGreaterThanOrEqual(560);
  expect(before?.width ?? 0).toBeGreaterThan(before?.height ?? 0);
  expect(Math.abs(
    (before?.x ?? 0) + (before?.width ?? 0) / 2 -
      ((stageBox?.x ?? 0) + (stageBox?.width ?? 0) / 2),
  )).toBeLessThanOrEqual(1);
  expect(Math.abs(
    (before?.y ?? 0) + (before?.height ?? 0) / 2 -
      ((stageBox?.y ?? 0) + (stageBox?.height ?? 0) / 2),
  )).toBeLessThanOrEqual(1);
  await page.locator(".world-stage-scroll").evaluate((element) =>
    element.scrollTo({ top: element.scrollHeight, behavior: "auto" }),
  );
  const after = await slot.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThanOrEqual(1);

  const secondAgent = page.locator(".agent-row").filter({ hasText: "Codex B" });
  await secondAgent.click();
  const openBubbles = page.locator("[data-world-conversation='open']");
  const secondDialog = page.getByRole("dialog", { name: "Codex B" });
  await expect(openBubbles).toHaveCount(2);
  await expect(page.getByRole("dialog", { name: "Codex A" })).toBeVisible();
  await expect(secondDialog).toBeVisible();
  await expect(connector.locator("path[data-anchor='workbench']")).toHaveCount(2);
  await expect(connector.locator("path[data-anchor='agent']")).toHaveCount(2);

  const officeStage = page.getByRole("region", { name: "Scrollable Pixel Office scene" });
  await expect(officeStage).toBeVisible();
  await expect
    .poll(() =>
      secondDialog.locator(".world-conversation-terminal").evaluate((element) =>
        element.contains(document.activeElement),
      ),
    )
    .toBe(true);
  // Let terminal autofocus settle, then move focus to the persistent page
  // region before exercising the page-level Escape handler.
  await officeStage.focus();
  await expect(officeStage).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(openBubbles).toHaveCount(1);
  await expect(page.getByRole("dialog", { name: "Codex A" })).toBeVisible();
  await officeStage.focus();
  await expect(officeStage).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(openBubbles).toHaveCount(0);
});

test("shows Office callouts and targets a new seat to the hovered room", async ({
  page,
  request,
}) => {
  await page.goto("/world");
  await waitForOffice(page);
  await page.getByRole("group", { name: "Host" }).getByRole("button", { name: "All", exact: true }).click();
  await waitForLiveOffice(page);

  const layout = await publishedOfficeLayout(page);
  const canvas = page.locator("canvas[data-office-canvas='true']");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  const firstDesk = deskAnchor(layout.rooms[0], 0);
  await page.mouse.move(
    (canvasBox?.x ?? 0) + firstDesk.x,
    (canvasBox?.y ?? 0) + firstDesk.nameY + 25,
  );
  await expect(page.getByRole("tooltip")).toContainText("Codex A");
  await expect(page.getByRole("tooltip")).toContainText("Running");
  const officeScroll = page.locator(".world-stage-scroll");
  const characterScrollTop = Math.max(0, firstDesk.characterFeetY - 260);
  await officeScroll.evaluate((element, top) => {
    element.scrollTo({ top, behavior: "auto" });
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }, characterScrollTop);
  await expect.poll(() => officeScroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const visibleCanvasBox = await canvas.boundingBox();
  expect(visibleCanvasBox).not.toBeNull();
  const visibleScrollTop = await officeScroll.evaluate((element) => element.scrollTop);
  await page.mouse.move(
    (visibleCanvasBox?.x ?? 0) + firstDesk.x,
    (visibleCanvasBox?.y ?? 0) + firstDesk.characterFeetY - visibleScrollTop - 60,
  );
  await expect(page.getByRole("tooltip")).toContainText("Codex A");
  await expect(page.getByRole("tooltip")).toContainText("Running");

  await page.locator(".agent-row").filter({ hasText: "Codex A" }).click();
  await expect(
    page.locator("[data-world-conversation='open']").filter({ hasText: "Codex A" }),
  ).toBeVisible();

  const newSeatButton = page.getByRole("button", { name: /^New seat in / }).first();
  await expect(newSeatButton).toBeVisible();
  const conversation = page.locator("[data-world-conversation='open']").filter({ hasText: "Codex A" });
  await moveConversationUntilClear(page, conversation, newSeatButton);
  await newSeatButton.click({ trial: true, timeout: 5_000 });
  await newSeatButton.click({ timeout: 5_000 });
  await expect(page.locator("form.launch-modal")).toBeVisible();
  await expect(
    page.locator("[data-world-conversation='open']").filter({ hasText: "Codex A" }),
  ).toBeVisible();
  await page.locator("form.launch-modal").getByRole("button", { name: "Create", exact: true }).click();
  await expect.poll(async () => {
    const logs = await (await request.get("http://127.0.0.1:4173/__fixture/requests")).json();
    return logs["host-a"].launches;
  }).toEqual([{
    preset_id: "shell",
    title: "Shell",
    target: { mode: "tab", workspace_id: "main" },
  }]);
});

test("keeps a long Office title contained while preserving its semantic label", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:4173/__fixture/state", {
    data: { hostId: "host-a", snapshotVariant: "long-title" },
  });
  await page.goto("/world");
  await waitForOffice(page);

  const fullTitle = "Research Workspace — " + "An Exceptionally Long Office Title ".repeat(24) + "🚀";
  const layout = await publishedOfficeLayout(page);
  const room = layout.rooms[0];
  const header = room.header;
  expect(room).toBeDefined();
  expect(header).toBeDefined();
  expect(header!.titleBoxX + header!.titleBoxWidth).toBeLessThanOrEqual(room.headerRect.width);
  expect(header!.renameX).toBeGreaterThanOrEqual(
    header!.titleBoxX + header!.titleBoxWidth + header!.actionGap - 1,
  );
  expect(header!.closeX + header!.closeWidth).toBeLessThanOrEqual(room.headerRect.width);
  expect(header!.workspace.length).toBeLessThan(fullTitle.length);

  await expect(page.locator('[aria-label="Office room names"]')).toContainText(fullTitle);
  await expect(page.getByRole("button", { name: `Rename room ${fullTitle}` })).toBeVisible();
});

test("keeps the live connector visible when the selected agent moves to the Agent Bar", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 640 });
  await page.goto("/world");
  await waitForOffice(page);
  await page.getByRole("group", { name: "Host" }).getByRole("button", { name: "All", exact: true }).click();
  await waitForLiveOffice(page);

  const initialLayout = await publishedOfficeLayout(page);
  const initialAgent = deskAnchor(initialLayout.rooms[0], 0);
  const stage = page.locator(".world-stage-scroll");
  const initialScrollTop = Math.max(0, initialAgent.characterFeetY - 300);
  await stage.evaluate((element, top) => element.scrollTo({ top, behavior: "auto" }), initialScrollTop);
  await expect.poll(() => stage.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await page.locator(".agent-row").filter({ hasText: "Codex A" }).click();
  const bubble = page.locator("[data-world-conversation='open']");
  const agentPath = page.locator("path[data-anchor='agent']");
  await expect(agentPath).toHaveCount(1);
  await expect(agentPath).not.toHaveAttribute("data-offscreen");
  const beforeAgentPath = await agentPath.getAttribute("d");

  const eventResponse = await request.post("http://127.0.0.1:4173/__fixture/ws-event", {
    data: {
      hostId: "host-a",
      path: "/ws/activity",
      event: {
        type: "pane.agent_status_changed",
        pane_id: "p1",
        workspace_id: "main",
        agent_status: "done",
        agent: "codex",
        title: null,
        display_agent: "Codex A",
        state_labels: { done: "Ready for review" },
      },
    },
  });
  expect((await eventResponse.json()).sent).toBeGreaterThan(0);

  await expect(page.locator(".agent-row").filter({ hasText: "Codex A" })).toContainText("Ready for review");
  await expect
    .poll(() => page.evaluate(() => window.__HERDR_WORLD_RENDERER__?.completionMarkers ?? 0))
    .toBeGreaterThan(0);
  await stage.evaluate((element) => element.scrollTo({ top: 0, behavior: "auto" }));
  await expect.poll(() => stage.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(bubble).toBeVisible();
  await expect(agentPath).toHaveCount(1);
  const afterAgentPath = await agentPath.getAttribute("d");
  expect(afterAgentPath).not.toBeNull();
  expect(afterAgentPath).not.toBe(beforeAgentPath);
  const offscreenEdge = await agentPath.getAttribute("data-offscreen");
  expect(offscreenEdge === null || ["bottom", "right"].includes(offscreenEdge)).toBe(true);
});

test("inspects completed work from the shared sidebar and clears its unseen marker", async ({
  page,
  request,
}) => {
  await page.goto("/world");
  await waitForOffice(page);

  const eventResponse = await request.post("http://127.0.0.1:4173/__fixture/ws-event", {
    data: {
      hostId: "host-a",
      path: "/ws/activity",
      event: {
        type: "pane.agent_status_changed",
        pane_id: "p1",
        workspace_id: "main",
        agent_status: "done",
        agent: "codex",
        title: null,
        display_agent: "Codex A",
        state_labels: { done: "Ready for review" },
      },
    },
  });
  expect((await eventResponse.json()).sent).toBeGreaterThan(0);

  const agentRow = page.locator(".agent-row").filter({ hasText: "Codex A" });
  await expect(agentRow).toContainText("Ready for review");
  await expect
    .poll(() => page.evaluate(() => window.__HERDR_WORLD_RENDERER__?.completionMarkers ?? 0))
    .toBeGreaterThan(0);

  await agentRow.click();
  await expect(page.locator("[data-world-conversation='open']")).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => window.__HERDR_WORLD_RENDERER__?.completionMarkers ?? 0))
    .toBe(0);

  await page.reload();
  await waitForOffice(page);
  await expect
    .poll(() => page.evaluate(() => window.__HERDR_WORLD_RENDERER__?.completionMarkers ?? 0))
    .toBe(0);
});

test("restores a still-live Office terminal after a page refresh", async ({ page }) => {
  await page.goto("/world");
  await waitForOffice(page);

  await page.locator(".agent-row").filter({ hasText: "Codex A" }).click();
  await expect(
    page.locator("[data-world-conversation='open']").filter({ hasText: "Codex A" }),
  ).toBeVisible();

  await page.reload();
  await waitForOffice(page);
  await expect(
    page.locator("[data-world-conversation='open']").filter({ hasText: "Codex A" }),
  ).toBeVisible();
});

test("deduplicates terminal windows and stops at the five-window Office cap", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:4173/__fixture/state", {
    data: { hostId: "host-a", snapshotVariant: "large" },
  });
  await page.goto("/world");
  await waitForOffice(page);
  const firstAgent = page.locator(".agent-row").filter({ hasText: "Agent 01" }).first();
  await expect(firstAgent).toBeVisible();

  await firstAgent.click();
  await expect(page.locator("[data-world-conversation='open']")).toHaveCount(1);
  await firstAgent.click();
  await expect(page.locator("[data-world-conversation='open']")).toHaveCount(1);

  for (const label of ["Agent 02", "Agent 03", "Agent 04", "Agent 05"]) {
    await page.locator(".agent-row").filter({ hasText: label }).first().click();
  }
  const openBubbles = page.locator("[data-world-conversation='open']");
  await expect(openBubbles).toHaveCount(5);
  await expect(page.getByRole("dialog", { name: "Agent 05" })).toBeVisible();

  await page.locator(".agent-row").filter({ hasText: "Agent 06" }).first().click();
  await expect(openBubbles).toHaveCount(5);
  await expect(page.locator(".world-stage-notice")).toHaveCount(0);
});

test("moves and resizes the Office conversation bubble without losing its live anchors", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/world");
  await waitForOffice(page);
  await page.getByRole("group", { name: "Host" }).getByRole("button", { name: "All", exact: true }).click();
  await waitForLiveOffice(page);

  await page.locator(".agent-row").filter({ hasText: "Codex A" }).click();
  const bubble = page.locator("[data-world-conversation='open']");
  const slot = page.locator(".world-conversation-slot").first();
  await expect(bubble).toBeVisible();
  await expect(page.locator(".world-conversation-resize")).toBeVisible();
  await expect(bubble.locator(".terminal-stage")).toHaveAttribute("data-terminal-translucent", "true");
  await expect.poll(async () => page.evaluate(() => {
    const hostElement = document.querySelector(".world-conversation-terminal .terminal-host");
    const host = hostElement?.getBoundingClientRect();
    const canvas = document.querySelector(".world-conversation-terminal .terminal-host canvas")?.getBoundingClientRect();
    if (!host || !canvas || !hostElement) {
      return false;
    }
    return getComputedStyle(hostElement).padding === "0px" &&
      getComputedStyle(hostElement).backgroundColor === "rgba(17, 17, 27, 0.88)" &&
      canvas.left >= host.left - 1 &&
      canvas.top >= host.top - 1 &&
      canvas.right <= host.right + 1 &&
      canvas.bottom <= host.bottom + 1 &&
      Math.abs((canvas.left - host.left) - (host.right - canvas.right)) <= 1 &&
      Math.abs((canvas.top - host.top) - (host.bottom - canvas.bottom)) <= 1;
  })).toBe(true);
  const accessibility = await new AxeBuilder({ page }).include(".world-stage-shell").analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);

  const beforeMove = await slot.boundingBox();
  const beforeWorkbenchPath = await page.locator("path[data-anchor='workbench']").getAttribute("d");
  const header = page.locator(".world-conversation-header");
  const headerBox = await header.boundingBox();
  expect(beforeMove).not.toBeNull();
  expect(headerBox).not.toBeNull();
  await page.mouse.move((headerBox?.x ?? 0) + 32, (headerBox?.y ?? 0) + 24);
  await page.mouse.down();
  await page.mouse.move((headerBox?.x ?? 0) + 112, (headerBox?.y ?? 0) - 16);
  await page.mouse.up();

  await expect.poll(async () => (await slot.boundingBox())?.x ?? 0).toBeCloseTo(
    (beforeMove?.x ?? 0) + 80,
    0,
  );
  const afterMove = await slot.boundingBox();
  expect(afterMove).not.toBeNull();
  expect(Math.abs((afterMove?.y ?? 0) - ((beforeMove?.y ?? 0) - 40))).toBeLessThanOrEqual(1);
  expect(Math.abs((afterMove?.width ?? 0) - (beforeMove?.width ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((afterMove?.height ?? 0) - (beforeMove?.height ?? 0))).toBeLessThanOrEqual(1);
  await expect.poll(() => page.locator("path[data-anchor='workbench']").getAttribute("d")).not.toBe(
    beforeWorkbenchPath,
  );

  const beforeResize = await slot.boundingBox();
  const resizeHandle = page.locator(".world-conversation-resize");
  const resizeBox = await resizeHandle.boundingBox();
  expect(beforeResize).not.toBeNull();
  expect(resizeBox).not.toBeNull();
  await page.mouse.move((resizeBox?.x ?? 0) + 12, (resizeBox?.y ?? 0) + 12);
  await page.mouse.down();
  await page.mouse.move(
    (resizeBox?.x ?? 0) + 52,
    (resizeBox?.y ?? 0) + 20,
    { steps: 30 },
  );
  await page.mouse.up();

  await expect.poll(async () => (await slot.boundingBox())?.width ?? 0).toBeGreaterThan(
    beforeResize?.width ?? 0,
  );
  await resizeHandle.focus();
  for (let index = 0; index < 3; index += 1) {
    await page.keyboard.press("Shift+ArrowRight");
  }
  const readInlineGeometry = () => slot.evaluate((element) => {
    const style = (element as HTMLElement).style;
    return {
      x: Number.parseFloat(style.left),
      y: Number.parseFloat(style.top),
      width: Number.parseFloat(style.width),
      height: Number.parseFloat(style.height),
    };
  });
  const afterResize = await readInlineGeometry();
  expect(afterResize.width).toBeGreaterThan(960);
  expect(afterResize.height).toBeGreaterThanOrEqual(beforeResize?.height ?? 0);
  await expect(slot).toHaveAttribute("data-positioned", "true");
  await page.evaluate(() => new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  }));
  const rendererAfterResize = await page.evaluate(() => ({
    sceneRenders: window.__HERDR_WORLD_RENDERER__?.sceneRenders ?? 0,
    sceneSkips: window.__HERDR_WORLD_RENDERER__?.sceneSkips ?? 0,
  }));
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => ({
    sceneRenders: window.__HERDR_WORLD_RENDERER__?.sceneRenders ?? 0,
    sceneSkips: window.__HERDR_WORLD_RENDERER__?.sceneSkips ?? 0,
  }))).toEqual(rendererAfterResize);

  await page.locator(".agent-row").filter({ hasText: "Codex B" }).click();
  await expect(page.getByRole("dialog", { name: "Codex B" })).toBeVisible();
  await expect(page.locator("[data-world-conversation='open']")).toHaveCount(2);
  const firstWindowAfterSecondOpen = await readInlineGeometry();
  expect(Math.abs(firstWindowAfterSecondOpen.x - afterResize.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(firstWindowAfterSecondOpen.y - afterResize.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(firstWindowAfterSecondOpen.width - afterResize.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(firstWindowAfterSecondOpen.height - afterResize.height)).toBeLessThanOrEqual(1);
});

test("uses the fixed mobile conversation layout without exposing desktop resize controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/world");
  await waitForOffice(page);
  await page.getByRole("button", { name: "Back to Herdr sidebar" }).click();
  await expect(page.getByRole("group", { name: "Sidebar view" })).toBeVisible();
  await page.locator(".agent-row").filter({ hasText: "Codex A" }).click();

  const bubble = page.locator("[data-world-conversation='open']");
  await expect(bubble).toBeVisible();
  await expect(page.locator(".world-conversation-resize")).toHaveCount(0);
  await expect(page.locator(".world-conversation-slot")).toHaveAttribute("data-positioned", "false");
});

test("passes Escape through to a focused Office terminal", async ({ page, request }) => {
  await page.goto("/world");
  await waitForOffice(page);
  await page.locator(".agent-row").filter({ hasText: "Codex A" }).click();

  const bubble = page.locator("[data-world-conversation='open']");
  await expect(bubble).toBeVisible();
  const terminalInput = bubble.locator(".terminal-host textarea.ghostty-hidden-input");
  await expect(terminalInput).toHaveCount(1);
  await terminalInput.focus();
  await page.keyboard.press("Escape");

  await expect(bubble).toBeVisible();
  await expect.poll(async () => {
    const logs = await (await request.get("http://127.0.0.1:4173/__fixture/requests")).json();
    return logs["host-a"].terminalInput.some(
      (message: { type: string; data: string }) => message.type === "input" && message.data === "\u001b",
    );
  }).toBe(true);
});

test("opens the conversation target in the full Spaces terminal", async ({ page }) => {
  await page.goto("/world");
  await waitForOffice(page);
  await page.locator(".agent-row").filter({ hasText: "Codex A" }).click();

  const bubble = page.locator("[data-world-conversation='open']");
  await expect(bubble).toBeVisible();
  await bubble.getByRole("button", { name: "Open full terminal in Spaces" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".stage-title")).toHaveText("Codex A");
  await expect(page.locator("[data-world-conversation='open']")).toHaveCount(0);
  await expect(page.locator(".terminal-stage")).toBeVisible();
});

test("opens the attached terminal when an occupied desk is selected", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:4173/__fixture/state", {
    data: { hostId: "host-a", snapshotVariant: "large" },
  });
  await page.goto("/world");
  await waitForOffice(page);
  await expect(page.locator(".agent-row").filter({ hasText: "Agent 01" })).toBeVisible();

  const layout = await publishedOfficeLayout(page);
  const desk = deskAnchor(layout.rooms[0], 0);
  const canvas = page.locator("canvas[data-office-canvas='true']");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  await page.mouse.move(
    (canvasBox?.x ?? 0) + desk.x,
    (canvasBox?.y ?? 0) + desk.nameY + 8,
  );
  await page.mouse.click(
    (canvasBox?.x ?? 0) + desk.x,
    (canvasBox?.y ?? 0) + desk.nameY + 8,
  );

  const bubble = page.locator("[data-world-conversation='open']");
  await expect(bubble).toBeVisible();
  await expect(bubble).toContainText("Agent 01");
  await expect(bubble.locator(".terminal-overlay")).toHaveCount(0);
});

test("keeps a desk terminal open when its idle agent moves onto the work floor", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:4173/__fixture/state", {
    data: { hostId: "host-a", snapshotVariant: "idle-desk" },
  });
  await page.goto("/world");
  await waitForOffice(page);

  const layout = await publishedOfficeLayout(page);
  const desk = deskAnchor(layout.rooms[0], 7);
  const canvas = page.locator("canvas[data-office-canvas='true']");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  await page.mouse.click(
    (canvasBox?.x ?? 0) + desk.x,
    (canvasBox?.y ?? 0) + desk.nameY + 8,
  );

  const bubble = page.locator("[data-world-conversation='open']");
  await expect(bubble).toBeVisible();
  await expect(bubble).toContainText("Agent 09");
  const beforeMovement = await page.locator(".world-conversation-slot").boundingBox();
  expect(beforeMovement).not.toBeNull();

  const eventResponse = await request.post("http://127.0.0.1:4173/__fixture/ws-event", {
    data: {
      hostId: "host-a",
      path: "/ws/activity",
      event: {
        type: "pane.agent_status_changed",
        pane_id: "large-pane-8",
        workspace_id: "workspace-1",
        agent_status: "working",
        agent: "codex",
        title: null,
        display_agent: "Agent 09",
        state_labels: { working: "Running" },
      },
    },
  });
  expect((await eventResponse.json()).sent).toBeGreaterThan(0);

  await expect(bubble).toBeVisible();
  await expect(page.locator(".agent-row").filter({ hasText: "Agent 09" }).first()).toContainText("Running");
  const afterMovement = await page.locator(".world-conversation-slot").boundingBox();
  expect(afterMovement).not.toBeNull();
  expect(Math.abs((afterMovement?.x ?? 0) - (beforeMovement?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((afterMovement?.y ?? 0) - (beforeMovement?.y ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((afterMovement?.width ?? 0) - (beforeMovement?.width ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((afterMovement?.height ?? 0) - (beforeMovement?.height ?? 0))).toBeLessThanOrEqual(1);
});

test("shows perceptible working animation when motion is allowed", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/world");
  await waitForOffice(page);
  await page.getByRole("group", { name: "Host" }).getByRole("button", { name: "All", exact: true }).click();
  await waitForLiveOffice(page);
  const start = await page.evaluate(() => window.__HERDR_WORLD_RENDERER__?.frames ?? 0);
  await page.waitForTimeout(1_000);
  const diagnostics = await page.evaluate(() => window.__HERDR_WORLD_RENDERER__);
  expect(diagnostics?.reducedMotion).toBe(false);
  expect(diagnostics?.animation).toEqual({ characters: 1, monitors: 1, statuses: 1 });
  expect((diagnostics?.frames ?? 0) - start).toBeGreaterThan(2);
});

test("keeps the Office renderer idle and responsive through rapid viewport resizing", async ({
  page,
}) => {
  await page.goto("/world");
  await waitForOffice(page);
  await page.waitForTimeout(500);
  const idleStart = await page.evaluate(() => window.__HERDR_WORLD_RENDERER__?.sceneSkips ?? 0);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__HERDR_WORLD_RENDERER__?.sceneSkips ?? 0))
    .toBe(idleStart);

  for (let cycle = 0; cycle < 4; cycle += 1) {
    for (const width of [1180, 960, 1240, 820, 1100, 760, 1320, 700]) {
      await page.setViewportSize({ width, height: 900 });
    }
  }
  await expect(page.getByRole("region", { name: "Scrollable Pixel Office scene" }))
    .toBeVisible();
  expect(await page.evaluate(() => new Promise<boolean>((resolve) => {
    window.requestAnimationFrame(() => resolve(true));
  }))).toBe(true);
});

test("does not rebuild the Pixi scene for an unchanged periodic snapshot", async ({
  page,
  request,
}) => {
  await page.goto("/world");
  await waitForOffice(page);
  const beforeLog = await fixtureLog(request);
  const before = await page.evaluate(() => {
    const diagnostics = window.__HERDR_WORLD_RENDERER__;
    return {
      sceneRenders: diagnostics?.sceneRenders ?? 0,
      sceneSkips: diagnostics?.sceneSkips ?? 0,
    };
  });
  expect(before.sceneRenders).toBeGreaterThan(0);

  await expect
    .poll(
      async () => (await fixtureLog(request)).snapshotRequests,
      { timeout: CORE_SNAPSHOT_REFRESH_INTERVAL_MS + 5_000 },
    )
    .toBeGreaterThan(beforeLog.snapshotRequests);
  await expect
    .poll(() => page.evaluate(() => window.__HERDR_WORLD_RENDERER__?.sceneSkips ?? 0))
    .toBeGreaterThan(before.sceneSkips);

  const after = await page.evaluate(() => window.__HERDR_WORLD_RENDERER__);
  expect(after?.sceneRenders).toBe(before.sceneRenders);
  expect(after?.activeApplications).toBe(1);
});

test("keeps single-click and empty-desk gestures read-only, then opens a canvas agent on double-click", async ({
  page,
  request,
}) => {
  const sockets: string[] = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  await page.goto("/world");
  await waitForOffice(page);
  await expect(page.locator(".agent-row").filter({ hasText: "Codex A" })).toBeVisible();
  await expect(page.locator(".world-stage-notice")).toHaveCount(0);

  const firstRoom = page.locator(".space-row").first();
  await firstRoom.click();
  await page.evaluate(() => new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  }));
  expect(await firstRoom.getAttribute("data-active")).toBe("true");
  expect(terminalSocketUrls(sockets)).toEqual([]);

  const layout = await publishedOfficeLayout(page);
  const agent = deskAnchor(layout.rooms[0], 0);
  const canvas = page.locator("canvas[data-office-canvas='true']");
  const position = { x: agent.x, y: agent.characterFeetY - 34 };

  await doubleClickCanvasPosition(page, canvas, position);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".stage-title")).toHaveText("Codex A");
  await expect
    .poll(() => terminalSocketUrls(sockets).filter((url) => url.startsWith("ws://127.0.0.1:4173")))
    .toHaveLength(1);
  await expect
    .poll(async () => {
      const logs = await (await request.get("http://127.0.0.1:4173/__fixture/requests")).json();
      return logs["host-a"].connections;
    })
    .toBe(1);
});

test("uses the same double-click shortcut for an Agent Bar sprite and roster row", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:4173/__fixture/state", {
    data: { hostId: "host-a", snapshotVariant: "large" },
  });
  await page.goto("/world");
  await waitForOffice(page);
  const barAgent = page.locator(".agent-row").filter({ hasText: "Agent 14" });
  await expect(page.locator(".world-canvas-agent-bar")).toBeVisible();
  await expect(barAgent).toContainText("Ready for review");

  await barAgent.dblclick();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".stage-title")).toHaveText("Agent 14");

  await page.getByRole("button", { name: "Office", exact: true }).click();
  await waitForOffice(page);
  await page.locator(".agent-row").filter({ hasText: "Agent 13" }).click();
  await page.getByRole("button", { name: "Close agent conversation" }).click();
  await expect(page.locator(".world-stage-notice")).toHaveCount(0);
  await page.locator(".world-agent-bar-item").filter({ hasText: "Agent 14" }).dblclick();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".stage-title")).toHaveText("Agent 14");
});

test("creates and manages rooms through capability-gated workspace actions", async ({
  page,
  request,
}) => {
  await page.goto("/world");
  await waitForOffice(page);

  const newRoom = page.getByRole("button", { name: "New room", exact: true });
  await expect(newRoom).toBeEnabled();
  await newRoom.click();
  await expect(page.locator(".modal-title")).toHaveText("Create room");
  await page.locator(".modal .field").fill("Research");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(async () => {
    const logs = await (await request.get("http://127.0.0.1:4173/__fixture/requests")).json();
    return logs["host-a"].commands;
  }).toContainEqual({
    method: "workspace.create",
    params: { focus: true, label: "Research" },
  });

  const layout = await publishedOfficeLayout(page);
  await page.locator("canvas[data-office-canvas='true']").click({
    position: { x: layout.rooms[0].x + 8, y: layout.rooms[0].y + 8 },
  });
  await expect(
    page.getByRole("button", { name: "Rename room main", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Rename room main", exact: true }).click();
  await page.locator(".modal .field").fill("Main Office");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(async () => {
    const logs = await (await request.get("http://127.0.0.1:4173/__fixture/requests")).json();
    return logs["host-a"].commands;
  }).toContainEqual({
    method: "workspace.rename",
    params: { workspace_id: "main", label: "Main Office" },
  });

  await page.getByRole("button", { name: "Close room main", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("This closes the Herdr workspace");
  await page.getByRole("button", { name: "Close room", exact: true }).click();
  await expect.poll(async () => {
    const logs = await (await request.get("http://127.0.0.1:4173/__fixture/requests")).json();
    return logs["host-a"].commands;
  }).toContainEqual({
    method: "workspace.close",
    params: { workspace_id: "main" },
  });
});

test("selects an Office agent semantically and launches a real new seat", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:4173/__fixture/state", {
    data: { hostId: "host-a", launchCreatesSeat: true },
  });
  await page.goto("/world");
  await waitForOffice(page);

  await page.locator(".agent-row").filter({ hasText: "Codex A" }).click();
  const bubble = page.locator("[data-world-conversation='open']").filter({ hasText: "Codex A" });
  await expect(bubble).toBeVisible();
  await expect(
    bubble.getByRole("button", { name: "Open full terminal in Spaces" }),
  ).toBeEnabled();
  await bubble.getByRole("button", { name: "Close agent conversation" }).click();

  const newSeatButton = page.getByRole("button", { name: /^New seat in / }).first();
  await expect(newSeatButton).toBeVisible();
  await newSeatButton.click();
  const launchDialog = page.locator("form.launch-modal");
  await expect(launchDialog).toBeVisible();
  await expect(launchDialog).toContainText("New tab");
  await launchDialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(launchDialog).toHaveCount(0);

  await expect.poll(async () => {
    const logs = await (await request.get("http://127.0.0.1:4173/__fixture/requests")).json();
    return logs["host-a"].launches;
  }).toEqual([
    {
      preset_id: "shell",
      title: "Shell",
      target: { mode: "tab", workspace_id: "main" },
    },
  ]);
  await page.locator(".agent-row").filter({ hasText: "Codex A" }).click();
  await expect(page.locator("[data-world-conversation='open']")).toHaveCount(2);
  await expect(
    page.locator("[data-world-conversation='open']").filter({ hasText: "Shell" }),
  ).toBeVisible();
});

test("opens the same standing room agent from its semantic row and canvas sprite", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:4173/__fixture/state", {
    data: { hostId: "host-a", snapshotVariant: "large" },
  });
  await page.goto("/world");
  await waitForOffice(page);
  const standingAgent = page.locator(".agent-row").filter({ hasText: "Agent 10" });
  await expect(standingAgent).toContainText("Running");

  await standingAgent.dblclick();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".stage-title")).toHaveText("Agent 10");

  await page.getByRole("button", { name: "Office", exact: true }).click();
  await waitForOffice(page);
  await page.locator(".agent-row").filter({ hasText: "Agent 02" }).click();
  await page.getByRole("button", { name: "Close agent conversation" }).click();
  await expect(page.locator(".world-stage-notice")).toHaveCount(0);
  const layout = await publishedOfficeLayout(page);
  const anchor = standingAnchor(layout.rooms[0], 1);
  const stage = page.locator(".world-stage-scroll");
  const scrollTop = layout.roomStartY - 40;
  await stage.evaluate((element, top) => element.scrollTo({ top, behavior: "auto" }), scrollTop);
  await expect.poll(() => stage.evaluate((element) => element.scrollTop)).toBe(scrollTop);
  const canvas = page.locator("canvas[data-office-canvas='true']");

  await doubleClickCanvasPosition(page, canvas, {
    x: anchor.x,
    y: anchor.characterFeetY - scrollTop - 34,
  });
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".stage-title")).toHaveText("Agent 10");
});

test("single-clicks then double-clicks the exact colliding host room", async ({
  page,
  request,
}) => {
  const sockets: string[] = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  const collisionStore = hostStore();
  collisionStore.enabledBridgeIds = ["same-origin", "host-b"];
  collisionStore.backends = collisionStore.backends.map((backend) =>
    backend.id === "host-b" ? { ...backend, name: "localhost" } : backend,
  );
  await page.addInitScript((store) => {
    localStorage.setItem("herdrWeb.bridgeBackends.v2", JSON.stringify(store));
  }, collisionStore);
  await page.goto("/world");
  await waitForOffice(page);
  await page.getByRole("group", { name: "Host" }).getByRole("button", { name: "All", exact: true }).click();
  await waitForLiveOffice(page);
  const rooms = page.locator(".space-row").filter({ hasText: "main" });
  await expect(rooms).toHaveCount(2);
  const hostARoom = rooms.nth(0);
  await page.locator(".app").evaluate((element) =>
    element.setAttribute("data-room-handoff-frame", "stable"));

  await hostARoom.click();
  await expect(page).toHaveURL(/\/world$/);
  await expect(hostARoom).toHaveAttribute("data-active", "true");
  expect(terminalSocketUrls(sockets)).toEqual([]);

  const layout = await publishedOfficeLayout(page);
  const hostBRect = layout.rooms[1];
  await page.locator("canvas[data-office-canvas='true']").dblclick({
    position: {
      x: hostBRect.x + hostBRect.width - 70,
      y: hostBRect.y + 54,
    },
  });
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".app")).toHaveAttribute("data-room-handoff-frame", "stable");
  await expect(page.locator(".stage-title")).toHaveText("Codex B");
  await expect
    .poll(() => terminalSocketUrls(sockets).filter((url) => url.startsWith("ws://127.0.0.1:4174")))
    .toHaveLength(1);
  await expect
    .poll(async () => {
      const logs = await (await request.get("http://127.0.0.1:4173/__fixture/requests")).json();
      return { hostA: logs["host-a"].connections, hostB: logs["host-b"].connections };
    })
    .toEqual({ hostA: 0, hostB: 1 });

  await page.getByRole("button", { name: "Office", exact: true }).click();
  await waitForOffice(page);
  await page.locator(".space-row").first().click();
  await expect(page.locator(".space-row").first()).toHaveAttribute("data-active", "true");
  await page.locator("canvas[data-office-canvas='true']").dblclick({
    position: {
      x: hostBRect.x + hostBRect.width - 70,
      y: hostBRect.y + 54,
    },
  });
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".stage-title")).toHaveText("Codex B");
});

test("revalidates a colliding live agent and opens its exact host in Spaces", async ({
  page,
  request,
}) => {
  const sockets: string[] = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  const collisionStore = hostStore();
  collisionStore.enabledBridgeIds = ["same-origin", "host-b"];
  collisionStore.backends = collisionStore.backends.map((backend) =>
    backend.id === "host-b" ? { ...backend, name: "localhost" } : backend,
  );
  await page.addInitScript((store) => {
    localStorage.setItem("herdrWeb.bridgeBackends.v2", JSON.stringify(store));
  }, collisionStore);
  await page.goto("/world");
  await waitForOffice(page);
  await page.getByRole("group", { name: "Host" }).getByRole("button", { name: "All", exact: true }).click();
  await waitForLiveOffice(page);
  await expect(page.getByRole("button", { name: "localhost, compatible" })).toHaveCount(2);

  await page.locator(".agent-row").filter({ hasText: "Codex B" }).dblclick();

  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("group", { name: "Host" }).getByRole("button", { name: "All", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".stage-title")).toHaveText("Codex B");
  await expect
    .poll(() => terminalSocketUrls(sockets).filter((url) => url.startsWith("ws://127.0.0.1:4174")))
    .toHaveLength(1);
  await expect
    .poll(async () => {
      const logs = await (await request.get("http://127.0.0.1:4173/__fixture/requests")).json();
      return {
        hostA: logs["host-a"].connections,
        hostB: logs["host-b"].connections,
      };
    })
    .toEqual({ hostA: 0, hostB: 1 });

  await page.getByRole("button", { name: "Office", exact: true }).click();
  await waitForOffice(page);
  await page.locator(".agent-row").filter({ hasText: "Codex A" }).click();
  await page.getByRole("button", { name: "Close agent conversation" }).click();
  await expect(page.locator(".world-stage-notice")).toHaveCount(0);
  const layout = await publishedOfficeLayout(page);
  const hostBReception = layout.ceoBlocks.receptions[1];
  expect(hostBReception).toBeDefined();
  const waitingAgent = receptionAgentAnchor(hostBReception, 0);
  await doubleClickCanvasPosition(
    page,
    page.locator("canvas[data-office-canvas='true']"),
    {
      x: waitingAgent.x,
      y: waitingAgent.characterFeetY - 34,
    },
  );
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".stage-title")).toHaveText("Codex B");
});

test("isolates a stale host, retains its last-known room, and suppresses handoff", async ({
  page,
  request,
}) => {
  await page.goto("/world");
  await waitForOffice(page);
  await page.getByRole("group", { name: "Host" }).getByRole("button", { name: "All", exact: true }).click();
  await waitForLiveOffice(page);
  await page.getByRole("button", { name: "Remote B, compatible" }).click();

  await request.post("http://127.0.0.1:4173/__fixture/state", {
    data: { hostId: "host-b", snapshotMode: "offline" },
  });
  await page.getByRole("button", { name: "Refresh" }).click();

  await expect(page.getByRole("button", { name: "Remote B, offline" })).toBeVisible();
  await page.getByRole("group", { name: "Host" }).getByRole("button", { name: "All", exact: true }).click();
  const staleAgent = page.locator(".agent-row").filter({ hasText: "Codex B" });
  await expect(staleAgent).toBeVisible();
  await staleAgent.click();
  await staleAgent.dblclick();
  await expect(page).toHaveURL(/\/world$/);
  await expect(page.locator(".world-stage-notice")).toHaveCount(0);
});

async function waitForOffice(page: import("@playwright/test").Page) {
  await expect
    .poll(() => page.evaluate(() => window.__HERDR_WORLD_RENDERER__?.ready ?? false))
    .toBe(true);
  await expect(page.locator("canvas[data-office-canvas='true']")).toHaveCount(1);
}

async function publishedOfficeLayout(page: Page): Promise<PublishedOfficeLayout> {
  await expect
    .poll(() => page.evaluate(() => window.__HERDR_WORLD_RENDERER__?.publishedLayout?.layoutRevision ?? 0))
    .toBeGreaterThan(0);
  const layout = await page.evaluate(() => window.__HERDR_WORLD_RENDERER__?.publishedLayout ?? null);
  expect(layout).not.toBeNull();
  return layout as PublishedOfficeLayout;
}

type Rectangle = {
  x: number;
  y: number;
  width: number;
  height: number;
};

async function moveConversationUntilClear(page: Page, conversation: Locator, target: Locator) {
  const header = conversation.locator(".world-conversation-header");
  const moves = [
    "Shift+ArrowRight",
    "Shift+ArrowLeft",
    "Shift+ArrowDown",
    "Shift+ArrowUp",
  ] as const;

  for (let attempt = 0; attempt < 48; attempt += 1) {
    const rectangles = await conversationAndTargetRectangles(conversation, target);
    if (!rectanglesIntersect(rectangles.conversation, rectangles.target)) {
      return;
    }

    const horizontalMove = rectangles.target.x + rectangles.target.width / 2
      >= rectangles.conversation.x + rectangles.conversation.width / 2
      ? "Shift+ArrowLeft"
      : "Shift+ArrowRight";
    const verticalMove = rectangles.target.y + rectangles.target.height / 2
      >= rectangles.conversation.y + rectangles.conversation.height / 2
      ? "Shift+ArrowUp"
      : "Shift+ArrowDown";
    const candidates = [horizontalMove, verticalMove, ...moves] as const;
    let moved = false;

    for (const move of candidates) {
      const before = await conversation.boundingBox();
      await header.focus();
      await page.keyboard.press(move);
      const after = await conversation.boundingBox();
      if (before && after && (before.x !== after.x || before.y !== after.y)) {
        moved = true;
        break;
      }
    }

    if (!moved) {
      throw new Error("Could not move the Office conversation away from the New seat control");
    }
  }

  throw new Error("Office conversation still intersects the New seat control after repositioning");
}

async function conversationAndTargetRectangles(conversation: Locator, target: Locator) {
  const [conversationBox, targetBox] = await Promise.all([
    conversation.boundingBox(),
    target.boundingBox(),
  ]);
  if (!conversationBox || !targetBox) {
    throw new Error("Could not measure the Office conversation and New seat control");
  }
  return {
    conversation: conversationBox,
    target: targetBox,
  } satisfies { conversation: Rectangle; target: Rectangle };
}

function rectanglesIntersect(first: Rectangle, second: Rectangle) {
  return first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;
}

async function waitForLiveOffice(page: import("@playwright/test").Page) {
  await expect(page.locator(".agent-row").filter({ hasText: "Codex A" })).toBeVisible();
  await expect(page.locator(".agent-row").filter({ hasText: "Codex B" })).toBeVisible();
}

function coreSocketUrls(urls: readonly string[]) {
  return urls.filter((url) => /\/ws\/(events|activity|ui-events)(?:\?|$)/.test(url));
}

function terminalSocketUrls(urls: readonly string[]) {
  return urls.filter((url) => /\/ws\/terminal(?:\?|$)/.test(url));
}

async function doubleClickCanvasPosition(
  page: Page,
  canvas: Locator,
  position: { x: number; y: number },
) {
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.dblclick(
    (bounds?.x ?? 0) + position.x,
    (bounds?.y ?? 0) + position.y,
  );
}

async function fixtureLog(request: import("@playwright/test").APIRequestContext) {
  const response = await request.get("http://127.0.0.1:4173/__fixture/requests");
  const all = (await response.json()) as Record<
    string,
    { snapshotRequests: number; capabilityRequests: number }
  >;
  return all["host-a"];
}

const CORE_SNAPSHOT_REFRESH_INTERVAL_MS = 10_000;
