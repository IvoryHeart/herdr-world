import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { hostStore } from "./hostStore";

const evidenceDir = resolve("docs/evidence/spec-010-extension-003");
const conversationEvidenceDir = resolve("docs/evidence/spec-001-office-agent-conversation-bubble");

test.use({ reducedMotion: "reduce" });
test.describe.configure({ timeout: 90_000 });

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
  await mkdir(conversationEvidenceDir, { recursive: true });
});

test.beforeEach(async ({ page, request }) => {
  await request.post("http://127.0.0.1:4173/__fixture/reset");
  await request.post("http://127.0.0.1:4173/__fixture/state", {
    data: { hostId: "host-a", snapshotVariant: "large" },
  });
  await page.addInitScript((store) => {
    localStorage.setItem("herdrWeb.bridgeBackends.v2", JSON.stringify(store));
  }, hostStore());
});

for (const viewport of [
  { width: 1920, height: 1200 },
  { width: 1440, height: 900 },
]) {
  test(`captures deterministic World at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/world");
    await waitForOffice(page);
    await waitForFrameFixtures(page);
    await page
      .getByRole("group", { name: "Host" })
      .getByRole("button", { name: "All", exact: true })
      .click();
    await waitForLiveOffice(page);
    await expect(page.locator(".brand-sub")).toHaveText("3 blocked");
    const selectedAgent = page.locator(".agent-row").filter({ hasText: "Agent 11" });
    await selectedAgent.click();
    await expect(page.locator(".world-stage-notice")).toHaveCount(0);
    await page.screenshot({
      path: resolve(evidenceDir, `world-live-${viewport.width}x${viewport.height}.png`),
      animations: "disabled",
    });
    await page.locator(".world-stage-scroll").evaluate((element) =>
      element.scrollTo({ top: element.scrollHeight, behavior: "auto" }));
    await page.screenshot({
      path: resolve(evidenceDir, `world-agent-bar-${viewport.width}x${viewport.height}.png`),
      animations: "disabled",
    });
  });
}

test("captures deterministic compact Office with shared sidebar at 375x812", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/world");
  await waitForOffice(page);
  await waitForFrameFixtures(page);
  await expect(page.getByRole("button", { name: "Back to Herdr sidebar" })).toBeVisible();
  await page.screenshot({
    path: resolve(evidenceDir, "world-live-375x812-office.png"),
    animations: "disabled",
  });

  await page.getByRole("button", { name: "Back to Herdr sidebar" }).click();
  await expect(page.getByRole("group", { name: "Sidebar view" })).toBeVisible();
  await page.screenshot({
    path: resolve(evidenceDir, "world-live-375x812-sidebar.png"),
    animations: "disabled",
  });
});

test("captures the stable Office conversation bubble", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/world");
  await waitForOffice(page);
  await page
    .getByRole("group", { name: "Host" })
    .getByRole("button", { name: "All", exact: true })
    .click();
  await waitForLiveOffice(page);
  await page.locator(".agent-row").filter({ hasText: "Agent 11" }).click();
  const conversation = page.locator("[data-world-conversation='open']");
  await expect(conversation).toBeVisible();
  await expect(conversation.locator(".terminal-overlay")).toHaveCount(0);
  await page.screenshot({
    path: resolve(conversationEvidenceDir, "office-conversation-1440x900.png"),
    animations: "disabled",
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/world");
  await waitForOffice(page);
  await page.getByRole("button", { name: "Back to Herdr sidebar" }).click();
  await expect(page.getByRole("group", { name: "Sidebar view" })).toBeVisible();
  await page.locator(".agent-row").filter({ hasText: "Agent 11" }).click();
  await selectOffice(page);
  await waitForOffice(page);
  await expect(page.locator("[data-world-conversation='open']")).toBeVisible();
  await page.screenshot({
    path: resolve(conversationEvidenceDir, "office-conversation-390x844.png"),
    animations: "disabled",
  });
});

async function waitForOffice(page: import("@playwright/test").Page) {
  await expect
    .poll(() => page.evaluate(() => window.__HERDR_WORLD_RENDERER__?.ready ?? false))
    .toBe(true);
  await expect(page.locator("canvas[data-office-canvas='true']")).toHaveCount(1);
}

async function selectOffice(page: Page) {
  await page.locator(".world-theme-selector > button").click();
  await page.getByRole("menu", { name: "World themes" })
    .getByRole("menuitemradio", { name: "Office", exact: true })
    .click();
}

async function waitForFrameFixtures(page: import("@playwright/test").Page) {
  await expect(page.getByRole("button", { name: "Remote B, compatible" })).toBeAttached();
  await expect(page.getByRole("button", { name: "Protocol C, incompatible" })).toBeAttached();
  await expect(page.getByRole("button", { name: "Malformed D, incompatible" })).toBeAttached();
  await expect(page.getByRole("button", { name: "Offline E, offline" })).toBeAttached();
}

async function waitForLiveOffice(page: import("@playwright/test").Page) {
  await expect(page.locator(".agent-row").filter({ hasText: "Agent 01" })).toBeAttached();
  await expect(page.locator(".agent-row").filter({ hasText: "Agent 11" })).toBeAttached();
}
