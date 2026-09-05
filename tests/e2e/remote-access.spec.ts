import { expect, test, type Page } from "@playwright/test";
import { hostStore } from "./hostStore";

test.beforeEach(async ({ page, request }) => {
  await request.post("http://127.0.0.1:4173/__fixture/reset");
  await page.addInitScript((store) => {
    localStorage.setItem("herdrWeb.bridgeBackends.v2", JSON.stringify(store));
  }, hostStore());
});

test("allows connections with advanced inbound permissions separate from destinations", async ({ page }) => {
  await page.goto("/spaces");
  await expect(page.getByRole("button", { name: "localhost, compatible" })).toBeVisible();
  await openSettings(page);
  await page.getByRole("tab", { name: "Allow connections" }).click();

  await expect(page.getByText("Allow connections", { exact: true }).last()).toBeVisible();
  const switchButton = page.getByRole("switch", { name: "Allow connections to this Herdr" });
  await expect(switchButton).toHaveAttribute("aria-checked", "false");
  await switchButton.click();
  await expect(page.getByText("http://bridge.example.test:4173", { exact: true })).toBeVisible();
  await page.getByLabel("Set connection password").fill("fixture-only-password");
  await expect(page.getByText(/Direct connections are not encrypted/iu)).toBeVisible();
  await page.getByText("Advanced network permissions", { exact: true }).click();
  await expect(page.getByText("Web pages allowed to connect", { exact: true })).toBeVisible();
  await expect(page.getByText("Herdrs this page may connect to", { exact: true })).toHaveCount(0);
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "Apply changes", exact: true }).click(),
  ]);

  await openSettings(page);
  await page.getByRole("tab", { name: "Allow connections" }).click();
  await expect(page.getByText("Password protected", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(/Network ready/iu);
});

test("adds and enables a connection from its address", async ({ page }) => {
  await page.goto("/spaces");
  await openSettings(page);
  await page.locator(".backend-row-main").filter({ hasText: "Remote B" }).click();
  await page.getByRole("button", { name: "Delete connection" }).click();
  await page.getByRole("button", { name: /Add connection/ }).click();
  await page.getByLabel("Herdr address").fill("http://127.0.0.1:4174");
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "Connect", exact: true }).click(),
  ]);

  await openSettings(page);
  const connection = page.locator(".backend-row-main").filter({ hasText: "127.0.0.1:4174" });
  await expect(connection).toContainText("Connected");
  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem("herdrWeb.bridgeBackends.v2");
    if (!raw) return false;
    const store = JSON.parse(raw) as { backends: { id: string; baseUrl: string }[]; enabledBridgeIds: string[] };
    const saved = store.backends.find((backend) => backend.baseUrl === "http://127.0.0.1:4174");
    return Boolean(saved && store.enabledBridgeIds.includes(saved.id));
  })).toBe(true);
});

test("authenticates a cross-origin Herdr and diagnoses HTTP, WebSocket, and terminal paths", async ({ page, request }) => {
  await request.post("http://127.0.0.1:4173/__fixture/state", {
    data: { hostId: "host-b", passwordConfigured: true },
  });
  await page.goto("/spaces");

  const prompt = page.getByRole("dialog", { name: "Connect to Herdr" });
  await expect(prompt).toBeVisible();
  await expect(prompt.getByText("Remote B", { exact: true })).toBeVisible();
  await expect(prompt.getByText("127.0.0.1:4174", { exact: true })).toBeVisible();
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

  await openSettings(page);
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "Allow saved connections & reload" }).click(),
  ]);

  await expect(prompt).toBeHidden();
  await openSettings(page);
  await page.locator(".backend-row-main").filter({ hasText: "Remote B" }).click();
  await page.getByRole("button", { name: "Test connection", exact: true }).click();

  await expect(page.getByText("Connection successful.", { exact: true })).toBeVisible();
});

test("clears a password before showing the next queued connection prompt", async ({ page, request }) => {
  for (const hostId of ["host-b", "host-c"]) {
    await request.post("http://127.0.0.1:4173/__fixture/state", {
      data: {
        hostId,
        passwordConfigured: true,
        ...(hostId === "host-c" ? { terminalProtocol: 20 } : {}),
      },
    });
  }
  await page.goto("/spaces");

  const prompt = page.getByRole("dialog", { name: "Connect to Herdr" });
  await expect(prompt).toBeVisible();
  const firstOrigin = await prompt.textContent();
  await prompt.getByLabel("Password").fill("fixture-only-password");
  await prompt.getByRole("button", { name: "Connect" }).click();

  await expect(prompt).toBeVisible();
  await expect.poll(async () => prompt.textContent()).not.toBe(firstOrigin);
  await expect(prompt.getByLabel("Password")).toHaveValue("");
  await expect(prompt.getByRole("button", { name: "Connect" })).toBeDisabled();
  await expect(prompt.getByLabel("Password")).toBeFocused();
  await prompt.getByRole("button", { name: "Cancel" }).click();
});

function switcherSettings(page: Page) {
  return page
    .getByRole("complementary", { name: "Switcher" })
    .locator('button[title^="Settings; Herdr:"]');
}

async function openSettings(page: Page) {
  await switcherSettings(page).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
}
