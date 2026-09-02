import { expect, test } from "@playwright/test";
import { hostStore } from "./hostStore";

test.beforeEach(async ({ page, request }) => {
  await request.post("http://127.0.0.1:4173/__fixture/reset");
  await page.addInitScript((store) => {
    localStorage.setItem("herdrWeb.bridgeBackends.v2", JSON.stringify(store));
  }, hostStore());
});

test("manages direct network access as a draft with separate browser permissions", async ({ page }) => {
  await page.goto("/spaces");
  await expect(page.getByRole("button", { name: "localhost, compatible" })).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).press("Enter");
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await page.getByRole("tab", { name: "Remote access" }).click();

  await expect(page.getByText("Direct network access", { exact: true })).toBeVisible();
  const switchButton = page.getByRole("switch", { name: "Allow direct network connections" });
  await expect(switchButton).toHaveAttribute("aria-checked", "false");
  await page.getByText("bridge.example.test", { exact: true }).click();
  await switchButton.click();
  await page.getByLabel("Set bridge password").fill("synthetic-password");
  await page.getByRole("button", { name: "Apply", exact: true }).click();

  await expect(page.getByText("Protected", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(/Bridge ready|Settings saved/iu);
});
