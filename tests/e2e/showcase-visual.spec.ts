import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const showcaseDir = resolve("docs/images");
const showcaseHostStore = {
  version: 2,
  enabledBridgeIds: ["same-origin", "demo-west"],
  lastSelectedBridgeId: "same-origin",
  backends: [
    { id: "demo-west", name: "Demo West", baseUrl: "http://127.0.0.1:4174" },
  ],
};

test.describe.configure({ timeout: 90_000 });

test.beforeAll(async () => {
  await mkdir(showcaseDir, { recursive: true });
});

test.beforeEach(async ({ page, request }) => {
  await request.post("http://127.0.0.1:4173/__fixture/reset");
  for (const hostId of ["host-a", "host-b"]) {
    const response = await request.post("http://127.0.0.1:4173/__fixture/state", {
      data: { hostId, snapshotVariant: "showcase" },
    });
    expect(response.ok()).toBe(true);
  }
  await page.addInitScript((store) => {
    localStorage.setItem("herdrWeb.bridgeBackends.v2", JSON.stringify(store));
    localStorage.removeItem("herdr.world.graph-view.v1");
    localStorage.removeItem("herdrWeb.worldView.v1");
  }, showcaseHostStore);
  await page.setViewportSize({ width: 1715, height: 1428 });
});

test("captures the public Graph overview from deterministic fixture data", async ({ page }) => {
  await page.goto("/?theme=graph");
  await waitForSettledGraph(page);
  await selectAllHosts(page);
  await expect(page.getByText("6 spaces · 15 terminals", { exact: true })).toBeVisible();
  await hideSwitcher(page);
  await waitForSettledGraph(page);
  await page.getByRole("button", { name: "Fit graph", exact: true }).click();
  await waitForSettledGraph(page);
  await page.screenshot({
    path: resolve(showcaseDir, "graph-overview.png"),
    animations: "disabled",
  });
});

test("captures connected terminals with canned fixture output", async ({ page }) => {
  await page.goto("/?theme=graph");
  await waitForSettledGraph(page);
  await selectAllHosts(page);
  await expect(page.getByText("6 spaces · 15 terminals", { exact: true })).toBeVisible();
  await hideSwitcher(page);
  await waitForSettledGraph(page);
  await page.getByRole("button", { name: "Fit graph", exact: true }).click();

  await page.locator(".graph-tree-terminal").filter({ hasText: "Codex Build" }).dblclick();
  await expect(page.locator("[data-world-conversation='open']").filter({ hasText: "Codex Build" }))
    .toBeVisible();
  const slots = page.locator(".world-conversation-slot");
  await expect(slots).toHaveCount(1);
  await arrangeWindow(page, slots.nth(0), -330, 390, -180, -320);
  await page.locator(".graph-tree-terminal").filter({ hasText: "Codex Release" })
    .evaluate((element) => element.dispatchEvent(new MouseEvent("dblclick", {
      bubbles: true,
      cancelable: true,
      view: window,
    })));
  await expect(page.locator("[data-world-conversation='open']").filter({ hasText: "Codex Release" }))
    .toBeVisible();

  await expect(slots).toHaveCount(2);
  await arrangeWindow(page, slots.nth(1), 330, -310, -180, -320);
  await page.getByRole("button", { name: "Fit graph", exact: true }).click();
  await waitForSettledGraph(page);
  await expect.poll(async () => {
    const response = await page.request.get("http://127.0.0.1:4173/__fixture/requests");
    const logs = await response.json() as Record<string, { connections: number }>;
    return logs["host-a"].connections + logs["host-b"].connections;
  }).toBe(2);
  await page.waitForTimeout(300);

  await page.screenshot({
    path: resolve(showcaseDir, "graph-live-terminals.png"),
    animations: "disabled",
  });
});

async function selectAllHosts(page: Page) {
  await page.getByRole("group", { name: "Host" })
    .getByRole("button", { name: "All", exact: true })
    .click();
}

async function hideSwitcher(page: Page) {
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await expect(page.locator(".app")).toHaveAttribute("data-sidebar", "closed");
}

async function arrangeWindow(
  page: Page,
  slot: import("@playwright/test").Locator,
  moveX: number,
  moveY: number,
  resizeX: number,
  resizeY: number,
) {
  const header = slot.getByRole("group", { name: "Move agent conversation" });
  const headerBox = await header.boundingBox();
  if (!headerBox) throw new Error("Showcase terminal header is not measurable");
  await page.mouse.move(headerBox.x + headerBox.width / 2, headerBox.y + headerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    headerBox.x + headerBox.width / 2 + moveX,
    headerBox.y + headerBox.height / 2 + moveY,
    { steps: 6 },
  );
  await page.mouse.up();

  const resize = slot.getByRole("button", { name: "Resize agent conversation" });
  const resizeBox = await resize.boundingBox();
  if (!resizeBox) throw new Error("Showcase terminal resize handle is not measurable");
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    resizeBox.x + resizeBox.width / 2 + resizeX,
    resizeBox.y + resizeBox.height / 2 + resizeY,
    { steps: 6 },
  );
  await page.mouse.up();
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
