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

  const results = await new AxeBuilder({ page }).include(".tree-stage-shell").analyze();
  expect(results.violations).toEqual([]);
});
