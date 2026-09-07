import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { hostStore } from "./hostStore";
import { expectHostState, hostTrigger, openHostMenu, selectAllHosts, selectHostById, selectSpaceScope, selectView, viewSelect } from "./sidebarControls";

const backendKey = "herdrWeb.bridgeBackends.v2";
const prefsKey = "herdr.mobileWeb.displayPrefs.v2";
const navigationKey = "herdr.mobileWeb.sharedNavigation.v1";

test.beforeAll(async () => {
  await mkdir(".scratch/playwright/evidence/sidebar-toolbar", { recursive: true });
});

test.beforeEach(async ({ request }) => {
  await request.post("http://127.0.0.1:4173/__fixture/reset");
});

async function seed(page: Page, prefs: Record<string, unknown> = {}, store = hostStore()) {
  await page.addInitScript(({ prefs, store, backendKey, prefsKey }) => {
    if (!localStorage.getItem(backendKey)) localStorage.setItem(backendKey, JSON.stringify(store));
    if (!localStorage.getItem(prefsKey)) localStorage.setItem(prefsKey, JSON.stringify(prefs));
  }, { prefs, store, backendKey, prefsKey });
}

async function addHost(page: Page, keyboard = false) {
  if (keyboard) {
    await hostTrigger(page).focus();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByRole("menuitem", { name: "Add Host", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
  } else {
    const menu = await openHostMenu(page);
    await expect(menu.locator("button").last()).toHaveText("Add Host");
    await expect(menu.getByRole("separator")).toBeVisible();
    await menu.getByRole("menuitem", { name: "Add Host", exact: true }).click();
  }
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("tab", { name: "Network", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(settings.getByRole("tab", { name: "Connections", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(settings.getByLabel("Herdr address", { exact: true })).toHaveValue("");
  await expect(settings.getByLabel("Herdr address", { exact: true })).toBeFocused();
  return settings;
}

async function snapshot(page: Page) {
  return page.evaluate(({ backendKey, prefsKey, navigationKey }) => ({
    url: location.href, history: history.length,
    backends: localStorage.getItem(backendKey),
    prefs: localStorage.getItem(prefsKey),
    navigation: localStorage.getItem(navigationKey),
  }), { backendKey, prefsKey, navigationKey });
}

for (const width of [320, 260]) {
  test(`fits compact controls in a ${width}px desktop sidebar`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seed(page, { sidebarWidth: width });
    await page.goto("/spaces");
    await expectHostState(page, "Offline E", "offline");
    await expect(page.locator("[data-toolbar-row]")).toHaveCount(2);
    const row = page.locator("[data-toolbar-row='list-scope']");
    const agents = row.getByRole("button", { name: "Agents", exact: true });
    const scope = row.getByRole("combobox", { name: "Space scope" });
    const bounds = await page.locator("aside.sidebar").boundingBox();
    expect(Math.round(bounds!.width)).toBe(width);
    for (const control of [viewSelect(page), hostTrigger(page), agents, row.getByRole("button", { name: "Tabs", exact: true }), row.getByRole("button", { name: "Notes", exact: true }), scope]) {
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(bounds!.x);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
    }
    if (width === 320) expect((await scope.boundingBox())!.y).toBe((await agents.boundingBox())!.y - 1);
    expect(await scope.evaluate((el: HTMLSelectElement) => {
      const context = document.createElement("canvas").getContext("2d")!;
      context.font = getComputedStyle(el).font;
      return context.measureText(el.selectedOptions[0].text).width + 30 <= el.clientWidth;
    })).toBe(true);
    expect(await page.locator(".sidebar-toolbar").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect((await page.locator(".sidebar .list").boundingBox())!.y).toBeLessThan(250);
    const header = page.locator("header.sb-head");
    await expect(header.getByRole("button", { name: "Settings", exact: true }).locator("svg.lucide-settings")).toBeVisible();
    await expect(header.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
    await expect(header.locator("svg.lucide-target")).toHaveCount(0);
    await page.locator("aside.sidebar").screenshot({ path: `.scratch/playwright/evidence/sidebar-toolbar/desktop-${width}.png` });
  });
}

test("Add Host cancels without changing navigation, filters or profiles and restores focus", async ({ page }) => {
  await seed(page);
  await page.goto("/?theme=graph");
  await selectHostById(page, "host-b");
  await selectAllHosts(page);
  await page.getByRole("group", { name: "Sidebar view" }).getByRole("button", { name: "Tabs", exact: true }).click();
  await selectSpaceScope(page, "all");
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}").scope, prefsKey)).toBe("all");
  const before = await snapshot(page);
  for (const keyboard of [false, true]) {
    const settings = await addHost(page, keyboard);
    await expect(settings.getByRole("button", { name: "Connect", exact: true })).toBeDisabled();
    if (keyboard) await page.keyboard.press("Escape");
    else await settings.getByRole("button", { name: "Close", exact: true }).click();
    await expect(settings).toHaveCount(0);
    await expect(hostTrigger(page)).toBeFocused();
    expect(await snapshot(page)).toEqual(before);
  }
});

test("Add Host uses the existing connection save and reload path", async ({ page }) => {
  await seed(page, {}, { ...hostStore(), enabledBridgeIds: ["same-origin"], backends: [] });
  await page.goto("/spaces");
  const settings = await addHost(page);
  await settings.getByLabel("Herdr address", { exact: true }).fill("http://127.0.0.1:4174");
  await expect(settings.getByLabel("Connection name")).toHaveValue("127.0.0.1");
  await Promise.all([page.waitForEvent("load"), settings.getByRole("button", { name: "Connect", exact: true }).click()]);
  await expect.poll(() => page.evaluate((key) => {
    const store = JSON.parse(localStorage.getItem(key) ?? "{}");
    return store.backends?.filter((profile: { id: string; baseUrl: string }) =>
      profile.baseUrl === "http://127.0.0.1:4174" && store.enabledBridgeIds.includes(profile.id)).length;
  }, backendKey)).toBe(1);
});

test("Hosts supports complete keyboard navigation, health inspection and outside dismissal", async ({ page }) => {
  await seed(page);
  await page.goto("/spaces");
  await expectHostState(page, "Offline E", "offline");
  await selectAllHosts(page);
  await expect(page.locator(".host-picker-summary")).toHaveText("3 hosts need attention");
  await hostTrigger(page).press("Enter");
  const menu = page.getByRole("menu", { name: "Hosts", exact: true });
  await expect(menu.getByRole("menuitemradio", { name: "All hosts", exact: true })).toBeFocused();
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem", { name: "Add Host" })).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("r");
  await expect(menu.getByRole("menuitemradio", { name: "Remote B, compatible" })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(menu).toHaveCount(0);
  await expect(hostTrigger(page)).toBeFocused();
  await hostTrigger(page).press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(hostTrigger(page)).toBeFocused();
  await hostTrigger(page).press("ArrowDown");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("group", { name: "Sidebar view" }).getByRole("button", { name: "Agents", exact: true })).toBeFocused();
  await hostTrigger(page).press("ArrowDown");
  await page.keyboard.press("Shift+Tab");
  await expect(viewSelect(page)).toBeFocused();
  await openHostMenu(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeFocused();
  await selectHostById(page, "host-e");
  await expect(page.locator(".host-picker-summary")).toContainText("offline");
  await selectAllHosts(page);
  await openHostMenu(page);
  await page.locator("aside.sidebar").screenshot({ path: ".scratch/playwright/evidence/sidebar-toolbar/hosts-menu.png" });
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? ""))).toEqual([]);
});

test("Add Host remains reachable with no enabled hosts and in a short scrolling popup", async ({ page }) => {
  await seed(page, {}, { ...hostStore(), enabledBridgeIds: [], backends: [] });
  await page.goto("/spaces");
  await expect(hostTrigger(page)).toContainText("No enabled hosts");
  await addHost(page, true);
  await page.keyboard.press("Escape");
  await expect(hostTrigger(page)).toBeFocused();
  await page.evaluate(({ key, store }) => localStorage.setItem(key, JSON.stringify(store)), { key: backendKey, store: hostStore() });
  await page.setViewportSize({ width: 1440, height: 400 });
  await page.reload();
  const menu = await openHostMenu(page);
  expect(await menu.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await menu.press("End");
  const add = menu.getByRole("menuitem", { name: "Add Host" });
  await expect(add).toBeInViewport();
  await add.press("Enter");
  await expect(page.getByLabel("Herdr address", { exact: true })).toBeFocused();
});

test("list mode and scope persist while disabled Notes falls back to Agents", async ({ page, request }) => {
  await request.post("http://127.0.0.1:4173/__fixture/state", { data: { hostId: "host-a", snapshotVariant: "large" } });
  await seed(page, { agentGroup: "workspace" });
  await page.addInitScript(() => localStorage.setItem("herdrWeb.navigationSyncMode.v1", "independent"));
  await page.goto("/spaces");
  const modes = page.getByRole("group", { name: "Sidebar view" });
  await modes.getByRole("button", { name: "Tabs", exact: true }).press("Enter");
  await selectSpaceScope(page, "space");
  await expect(page.locator(".tabgrp")).toHaveCount(9);
  await page.locator(".space-row").filter({ hasText: "Workspace 002" }).click();
  await expect(page.locator(".tabgrp")).toHaveCount(0);
  await selectSpaceScope(page, "all");
  await expect(page.locator(".tabgrp")).toHaveCount(9);
  await page.reload();
  await expect(modes.getByRole("button", { name: "Tabs", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("combobox", { name: "Space scope" })).toHaveValue("all");
  await modes.getByRole("button", { name: "Notes", exact: true }).press("Enter");
  await page.reload();
  await expect(modes.getByRole("button", { name: "Notes", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) ?? "{}"), notesEnabled: false })), prefsKey);
  await page.reload();
  await expect(modes.getByRole("button", { name: "Notes", exact: true })).toHaveCount(0);
  await expect(modes.getByRole("button", { name: "Agents", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test.describe("phone toolbar", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test("keeps two rows, touch targets, lazy navigation focus and one-entry history", async ({ page }) => {
    await seed(page);
    await page.route("**/assets/WorldSurface-*.js", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.continue();
    });
    await page.goto("/spaces");
    const row = page.locator("[data-toolbar-row='list-scope']");
    const group = row.getByRole("group", { name: "Sidebar view" });
    expect((await row.getByRole("combobox").boundingBox())!.y).toBe((await group.boundingBox())!.y + 1);
    for (const control of [viewSelect(page), hostTrigger(page), row.getByRole("combobox"), ...await group.getByRole("button").all()]) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? ""))).toEqual([]);
    const before = await page.evaluate(() => history.length);
    await selectView(page, "Office");
    const back = page.getByRole("button", { name: "Back to Herdr sidebar" });
    await expect(back).toBeFocused();
    await expect(page.locator("aside.sidebar")).toHaveAttribute("inert", "");
    expect(await page.evaluate(() => history.length)).toBe(before + 1);
    await page.goBack();
    await expect(viewSelect(page)).toBeFocused();
    await expect(viewSelect(page)).toHaveValue("spaces");
    await page.goForward();
    await expect(back).toBeFocused();
    await back.click();
    await expect(viewSelect(page)).toBeFocused();
    const same = await snapshot(page);
    await selectView(page, "Spaces");
    expect(await snapshot(page)).toEqual(same);
    await expect(page.locator(".app")).toHaveAttribute("data-detail", "false");
    await selectView(page, "Graph");
    await expect(back).toBeFocused();
    await back.click();
    await selectView(page, "Spaces");
    await expect(page.locator(".app")).toHaveAttribute("data-detail", "false");
    await addHost(page, true);
    await page.keyboard.press("Escape");
    await expect(hostTrigger(page)).toBeFocused();
    await expect.poll(async () => Math.round((await page.locator("aside.sidebar").boundingBox())!.x)).toBe(0);
    await page.screenshot({ path: ".scratch/playwright/evidence/sidebar-toolbar/phone.png", animations: "disabled" });
  });
});

test("Settings keeps focus through a desktop-to-phone resize", async ({ page }) => {
  await seed(page);
  await page.goto("/");
  await expect(page.locator("canvas[data-office-canvas='true']")).toBeVisible();
  const settings = await addHost(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(settings.getByLabel("Herdr address", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  expect(await settings.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[inert]")))).toBe(false);
});

for (const [chunk, view] of [["WorldThemeStage", "Office"], ["GraphTheme", "Graph"]] as const) {
  test(`retains a keyboard recovery path when ${chunk} fails to load`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seed(page);
    await page.route(`**/assets/${chunk}-*.js`, (route) => route.abort());
    await page.goto("/spaces");
    await selectView(page, view);
    await expect(page.locator(".surface-unavailable")).toBeVisible();
    const back = page.getByRole("button", { name: "Back to Herdr sidebar", exact: true });
    await expect(back).toBeFocused();
    await back.press("Enter");
    await expect(viewSelect(page)).toBeFocused();
    await expect(page.locator(".app")).toHaveAttribute("data-detail", "false");
  });
}

test("duplicate host names remain distinguishable and route only to the selected runtime", async ({ page, request }) => {
  const store = hostStore();
  store.enabledBridgeIds = ["same-origin", "host-b"];
  store.backends = store.backends.filter((profile) => profile.id === "host-b").map((profile) => ({ ...profile, name: "localhost" }));
  await seed(page, {}, store);
  await page.goto("/spaces");
  const menu = await openHostMenu(page);
  await expect(menu.getByRole("menuitemradio", { name: "localhost (This Herdr), compatible", exact: true })).toBeVisible();
  await menu.getByRole("menuitemradio", { name: "localhost (http://127.0.0.1:4174), compatible", exact: true }).click();
  await page.getByRole("button", { name: /^Codex B / }).click();
  await page.locator(".terminal-stage").click();
  await page.keyboard.type("qualified-host-b");
  await page.getByRole("button", { name: "New space", exact: true }).click();
  await expect.poll(async () => {
    const logs = await (await request.get("http://127.0.0.1:4173/__fixture/requests")).json();
    return {
      a: { commands: logs["host-a"].commands, input: logs["host-a"].terminalInput },
      b: { commands: logs["host-b"].commands.map((command: { method: string }) => command.method),
        input: logs["host-b"].terminalInput.filter((frame: { type: string }) => frame.type === "input")
          .map((frame: { data: string }) => frame.data).join("") },
    };
  }).toEqual({ a: { commands: [], input: [] }, b: { commands: expect.arrayContaining(["workspace.create"]), input: "qualified-host-b" } });
  await selectAllHosts(page);
  await selectSpaceScope(page, "all");
  await expect(hostTrigger(page)).toContainText("All hosts");
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}").selectedBridgeId, navigationKey)).toBe("host-b");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Herdr address", { exact: true })).toHaveValue("http://127.0.0.1:4174");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeFocused();
  const before = (await (await request.get("http://127.0.0.1:4173/__fixture/requests")).json())["host-b"].snapshotRequests;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(async () => (await (await request.get("http://127.0.0.1:4173/__fixture/requests")).json())["host-b"].snapshotRequests).toBeGreaterThan(before);
});
