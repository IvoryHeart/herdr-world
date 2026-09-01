import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { hostStore } from "./hostStore";

test.use({ reducedMotion: "reduce" });

test.beforeEach(async ({ page, request }) => {
  await request.post("http://127.0.0.1:4173/__fixture/reset");
  await page.addInitScript((store) => {
    localStorage.setItem("herdrWeb.bridgeBackends.v2", JSON.stringify(store));
  }, hostStore());
});

test("core controls are keyboard-visible, labelled, reduced-motion safe, and axe clean", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/spaces");
  await expect
    .poll(() =>
      page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("button", { name: "localhost, compatible" }),
  ).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);

  const settings = page.getByRole("button", { name: "Settings" });
  await settings.focus();
  await expect(settings).toBeFocused();
  expect(
    await settings.evaluate(
      (element) => getComputedStyle(element).outlineStyle,
    ),
  ).not.toBe("none");

  await settings.press("Enter");
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(settings).toBeFocused();

  const rowAnimation = await page
    .locator(".space-row")
    .first()
    .evaluate((element) => getComputedStyle(element).animationDuration);
  expect(Number.parseFloat(rowAnimation)).toBeLessThanOrEqual(0.00001);
  await expect(
    page.getByRole("button", { name: "Refit terminal" }),
  ).toBeEnabled();
});
