import { expectHostState, selectAllHosts, selectHost } from "./sidebarControls";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { hostStore } from "./hostStore";

const evidenceDir = resolve(".scratch/playwright/evidence/spec-010");

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

test.beforeEach(async ({ request }) => {
  await request.post("http://127.0.0.1:4173/__fixture/reset");
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1920, height: 1200 },
]) {
  test(`captures federated desktop at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript((store) => {
      localStorage.setItem("herdrWeb.bridgeBackends.v2", JSON.stringify(store));
    }, hostStore());
    await page.goto("/spaces");
    await selectAllHosts(page);
    await expect(page.getByRole("button", { name: /^Codex A / })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Codex B / })).toBeVisible();
    await expectHostState(page, "Offline E", "offline");
    await page.screenshot({
      path: resolve(
        evidenceDir,
        `responsive-${viewport.width}x${viewport.height}.png`,
      ),
      fullPage: true,
    });
  });
}

test("captures the 375x812 switcher and usable terminal", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript((store) => {
    localStorage.setItem("herdrWeb.bridgeBackends.v2", JSON.stringify(store));
  }, hostStore());
  await page.goto("/spaces");
  await expectHostState(page, "Offline E", "offline");
  await page.screenshot({
    path: resolve(evidenceDir, "responsive-375x812-switcher.png"),
    fullPage: true,
  });

  await selectHost(page, "Remote B", "compatible");
  await page.getByRole("button", { name: /^Codex B / }).click();
  await expect(
    page.getByRole("button", { name: "Back to switcher" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refit terminal" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".stage")
        .evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m41),
    )
    .toBe(0);
  await page.screenshot({
    path: resolve(evidenceDir, "responsive-375x812-terminal.png"),
    fullPage: true,
  });
});

test("keeps the terminal responsive through rapid window resizing", async ({ page }) => {
  await page.addInitScript((store) => {
    localStorage.setItem("herdrWeb.bridgeBackends.v2", JSON.stringify(store));
  }, hostStore());
  await page.goto("/spaces");
  await selectHost(page, "Remote B", "compatible");
  await page.getByRole("button", { name: /^Codex B / }).click();
  await expect(page.getByRole("button", { name: "Refit terminal" })).toBeVisible();

  for (let cycle = 0; cycle < 8; cycle += 1) {
    for (const width of [1180, 960, 1240, 820, 1100, 760, 1320, 700]) {
      await page.setViewportSize({ width, height: 900 });
    }
  }

  await expect(page.locator(".terminal-stage")).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to switcher" })).toBeVisible();
  await page.reload();
  await expect(page.locator(".terminal-stage")).toBeVisible();
});

test("keeps narrow-stage header actions above the collapsed-sidebar theme switcher", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/spaces");
  const refit = page.getByRole("button", { name: "Refit terminal" });
  await expect(refit).toBeVisible();

  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await expect(page.locator(".app")).toHaveAttribute("data-sidebar", "closed");
  await page.locator(".stage > .stage-bar").getByRole("button", { name: "Notes" }).click();
  await expect(page.locator(".app")).toHaveAttribute("data-notes", "open");
  await page.setViewportSize({ width: 821, height: 900 });
  await expect.poll(async () =>
    Math.round((await page.locator(".stage").boundingBox())?.width ?? 0),
  ).toBe(261);

  await page.screenshot({
    path: resolve(evidenceDir, "responsive-821x900-collapsed-notes.png"),
    animations: "disabled",
  });
  const refitBox = await refit.boundingBox();
  expect(refitBox).not.toBeNull();
  const hitTargetLabel = await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y);
    return target?.closest("button")?.getAttribute("aria-label") ?? null;
  }, {
    x: refitBox!.x + refitBox!.width / 2,
    y: refitBox!.y + refitBox!.height / 2,
  });
  expect(hitTargetLabel).toBe("Refit terminal");
});

test("keeps the collapsed-sidebar theme switcher inside an empty Spaces header", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:4173/__fixture/state", {
    data: { hostId: "host-a", snapshotVariant: "empty" },
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/spaces");
  await expect(page.locator(".stage-sub")).toHaveText("no pane selected");
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await expect(page.locator(".app")).toHaveAttribute("data-sidebar", "closed");
  await expect(page.locator(".tabbar")).toHaveCount(0);

  const headerBox = await page.locator(".stage > .stage-bar").boundingBox();
  const switcherBox = await page.locator(".stage-theme-switcher").boundingBox();
  expect(headerBox).not.toBeNull();
  expect(switcherBox).not.toBeNull();
  expect(switcherBox!.y).toBeGreaterThanOrEqual(headerBox!.y);
  expect(switcherBox!.y + switcherBox!.height).toBeLessThanOrEqual(
    headerBox!.y + headerBox!.height,
  );
  await page.screenshot({
    path: resolve(evidenceDir, "responsive-empty-spaces-switcher.png"),
    animations: "disabled",
  });
});
