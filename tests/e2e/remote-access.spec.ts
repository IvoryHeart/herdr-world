import { expect, test, type Page } from "@playwright/test";
import { hostStore } from "./hostStore";

test.beforeEach(async ({ page, request }) => {
  await request.post("http://127.0.0.1:4173/__fixture/reset");
  await page.addInitScript((store) => {
    localStorage.setItem("herdrWeb.bridgeBackends.v2", JSON.stringify(store));
  }, hostStore());
});

test("shares this machine with host settings separate from bridge destinations", async ({ page }) => {
  await page.goto("/spaces");
  await expect(page.getByRole("button", { name: "localhost, compatible" })).toBeVisible();
  await switcherSettings(page).press("Enter");
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await page.getByRole("tab", { name: "Share this machine" }).click();

  await expect(page.getByText("Share this bridge", { exact: true })).toBeVisible();
  const switchButton = page.getByRole("switch", { name: "Allow other devices to connect" });
  await expect(switchButton).toHaveAttribute("aria-checked", "false");
  await switchButton.click();
  await expect(page.getByText("http://bridge.example.test:4173", { exact: true })).toBeVisible();
  await page.getByLabel("Set this bridge password").fill("fixture-only-password");
  await expect(page.getByText(/unencrypted HTTP and WebSocket connections/iu)).toBeVisible();
  await page.getByText("Advanced browser permissions", { exact: true }).click();
  await expect(page.getByText("Client web app origins", { exact: true })).toBeVisible();
  await expect(page.getByText("Bridge destinations for this page", { exact: true })).toHaveCount(0);
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "Apply", exact: true }).click(),
  ]);

  await switcherSettings(page).press("Enter");
  await page.getByRole("tab", { name: "Share this machine" }).click();
  await expect(page.getByText("Protected", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(/Bridge ready/iu);
});

test("authenticates a cross-origin bridge and diagnoses HTTP, WebSocket, and terminal paths", async ({ page, request }) => {
  await request.post("http://127.0.0.1:4173/__fixture/state", {
    data: { hostId: "host-b", passwordConfigured: true },
  });
  await page.goto("/spaces");

  const prompt = page.getByRole("dialog", { name: "Bridge password" });
  await expect(prompt).toBeVisible();
  await prompt.getByLabel("Password").fill("fixture-only-password");
  await prompt.getByRole("button", { name: "Connect" }).click();
  await expect(prompt).toBeHidden();
  await expect.poll(() => page.evaluate(() => (
    sessionStorage.getItem(
      `herdrWeb.bridgeSession.v1:${encodeURIComponent("http://127.0.0.1:4174")}`,
    )
  ))).not.toBeNull();

  await page.reload();
  await expect(prompt).toBeHidden();

  await switcherSettings(page).press("Enter");
  await page.getByRole("tab", { name: "Bridges" }).click();
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "Allow saved bridges & reload" }).click(),
  ]);

  await expect(prompt).toBeHidden();
  await switcherSettings(page).press("Enter");
  await page.getByRole("tab", { name: "Bridges" }).click();
  await page.locator(".backend-row-main").filter({ hasText: "Remote B" }).click();
  await page.getByRole("button", { name: "Test", exact: true }).click();

  await expect(page.getByText("Backend reachable.", { exact: true })).toBeVisible();
});

function switcherSettings(page: Page) {
  return page
    .getByRole("complementary", { name: "Switcher" })
    .getByRole("button", { name: "Settings" });
}
