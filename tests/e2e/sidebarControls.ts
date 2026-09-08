import { expect, type Locator, type Page } from "@playwright/test";

export function viewSelect(page: Page) {
  return page.getByRole("combobox", { name: "View" });
}

export async function selectView(page: Page, label: "Office" | "Tree" | "Graph" | "Spaces") {
  await viewSelect(page).selectOption(label.toLowerCase());
}

export function hostTrigger(page: Page) {
  return page.getByRole("button", { name: /^Hosts:/ });
}

export async function openHostMenu(page: Page) {
  const menu = page.getByRole("menu", { name: "Hosts" });
  if (!(await menu.isVisible())) {
    await hostTrigger(page).click();
  }
  await expect(menu).toBeVisible();
  return menu;
}

export async function selectAllHosts(page: Page) {
  const menu = await openHostMenu(page);
  await menu.getByRole("menuitemradio", { name: "All hosts", exact: true }).click();
}

export async function selectHost(page: Page, label: string, state?: string) {
  const menu = await openHostMenu(page);
  const name = state ? `${label}, ${state}` : new RegExp(`^${escapeRegExp(label)},`);
  await menu.getByRole("menuitemradio", { name }).click();
}

export async function selectHostById(page: Page, bridgeId: string) {
  const menu = await openHostMenu(page);
  await menu.locator(`[data-host-id="${bridgeId}"]`).click();
}

export async function selectSpaceScope(page: Page, scope: "space" | "all") {
  await page.getByRole("combobox", { name: "Space scope" }).selectOption(scope);
}

export function hostOption(menu: Locator, bridgeId: string) {
  return menu.locator(`[data-host-id="${bridgeId}"]`);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function expectHostState(page: Page, label: string, state: string) {
  const menu = await openHostMenu(page);
  await expect(menu.getByRole("menuitemradio", { name: `${label}, ${state}`, exact: true })).toBeVisible();
  await menu.press("Escape");
}

export async function openView(page: Page, label: "Office" | "Tree" | "Graph") {
  await selectView(page, label);
  const reopen = page.getByRole("button", { name: `Open ${label} view`, exact: true });
  if (await page.locator(".app").getAttribute("data-compact") === "true" &&
      await page.locator(".app").getAttribute("data-detail") === "false") await reopen.click();
}
