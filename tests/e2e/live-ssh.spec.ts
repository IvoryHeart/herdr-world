import { expect, test } from "@playwright/test";

const bridgeA = process.env.HERDR_WEB_LIVE_SSH_BRIDGE_A;
const bridgeB = process.env.HERDR_WEB_LIVE_SSH_BRIDGE_B;

test("one browser controls two operator-forwarded Herdr bridges", async ({
  page,
}) => {
  test.skip(
    !bridgeA || !bridgeB,
    "set both live SSH bridge origins to run the operator smoke",
  );

  await page.addInitScript(
    ({ remoteOrigin }) => {
      localStorage.setItem(
        "herdrWeb.bridgeBackends.v2",
        JSON.stringify({
          version: 2,
          enabledBridgeIds: ["same-origin", "ssh-host-b"],
          lastSelectedBridgeId: "same-origin",
          backends: [
            { id: "ssh-host-b", name: "SSH Host B", baseUrl: remoteOrigin },
          ],
        }),
      );
    },
    { remoteOrigin: bridgeB },
  );

  await page.goto(new URL("/spaces", bridgeA).toString());
  await expect(
    page.getByRole("button", { name: "localhost, compatible" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "SSH Host B, compatible" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "SSH Host B, compatible" }).click();
  await expect(
    page.getByRole("button", { name: "Refit terminal" }),
  ).toBeEnabled();
  await page.locator(".terminal-stage").click();
  await page.keyboard.type("printf 'SPEC010_SSH_BROWSER_OK\\n'\n");
  await page.waitForTimeout(300);
});
