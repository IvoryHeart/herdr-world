import { selectAllHosts } from "./sidebarControls";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { hostStore } from "./hostStore";

test.use({ reducedMotion: "no-preference" });

test.beforeEach(async ({ page, request }) => {
  await request.post("http://127.0.0.1:4173/__fixture/reset");
  for (const hostId of ["host-a", "host-b"]) {
    await request.post("http://127.0.0.1:4173/__fixture/state", {
      data: { hostId, snapshotVariant: "empty" },
    });
  }
  const store = hostStore();
  store.enabledBridgeIds = ["same-origin", "host-b"];
  await page.addInitScript((value) => {
    localStorage.setItem("herdrWeb.bridgeBackends.v2", JSON.stringify(value));
  }, store);
});

test("sustains the bounded 129-room fixture within the frame and memory budgets", async ({
  browser,
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/world");
  await waitForOffice(page);
  await selectAllHosts(page);
  await expect(page.locator(".space-row")).toHaveCount(0);
  await expect(page.getByText("No spaces yet", { exact: true })).toBeVisible();

  const renderer = await webGlRenderer(page);
  test.skip(
    !renderer || /SwiftShader/iu.test(renderer),
    `Hardware WebGL is required for the approved frame-rate sample; detected ${renderer ?? "none"}`,
  );

  const browserSession = await browser.newBrowserCDPSession();
  const pageSession = await page.context().newCDPSession(page);
  await pageSession.send("HeapProfiler.collectGarbage");
  await page.waitForTimeout(1_000);
  const baselineRssMiB = await browserRssMiB(browserSession);

  for (const hostId of ["host-a", "host-b"]) {
    await request.post("http://127.0.0.1:4173/__fixture/state", {
      data: { hostId, snapshotVariant: "large" },
    });
    const response = await request.post("http://127.0.0.1:4173/__fixture/ws-event", {
      data: {
        hostId,
        path: "/ws/events",
        event: { type: "snapshot_changed" },
      },
    });
    expect((await response.json()).sent).toBeGreaterThan(0);
  }

  await expect(page.locator(".space-row")).toHaveCount(128);
  await expect
    .poll(() => page.evaluate(() => window.__HERDR_WORLD_RENDERER__?.layout?.rooms ?? 0))
    .toBe(128);
  await expect(page.locator(".agent-row")).toHaveCount(16);
  await page.waitForTimeout(2_000);

  const start = await page.evaluate(() => ({
    frames: window.__HERDR_WORLD_RENDERER__?.frames ?? 0,
    time: performance.now(),
  }));
  await page.waitForTimeout(10_000);
  const end = await page.evaluate(() => ({
    frames: window.__HERDR_WORLD_RENDERER__?.frames ?? 0,
    time: performance.now(),
  }));
  const seconds = (end.time - start.time) / 1_000;
  const fps = (end.frames - start.frames) / seconds;

  await pageSession.send("HeapProfiler.collectGarbage");
  await page.waitForTimeout(1_000);
  const largeRssMiB = await browserRssMiB(browserSession);
  const rssDeltaMiB = largeRssMiB - baselineRssMiB;
  console.log(JSON.stringify({ renderer, fps, baselineRssMiB, largeRssMiB, rssDeltaMiB }));

  expect(fps).toBeGreaterThanOrEqual(55);
  expect(rssDeltaMiB).toBeLessThanOrEqual(120);

  const stage = page.locator(".world-stage-scroll");
  await stage.evaluate((element) => element.scrollTo({ top: element.scrollHeight, behavior: "auto" }));
  await expect.poll(() => stage.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const stickyGeometry = await page.evaluate(() => {
    const stageElement = document.querySelector(".world-stage-scroll");
    const canvas = document.querySelector("canvas[data-office-canvas='true']");
    const stageRect = stageElement?.getBoundingClientRect();
    const canvasRect = canvas?.getBoundingClientRect();
    return {
      stageTop: stageRect?.top ?? -1,
      canvasTop: canvasRect?.top ?? -2,
      ready: window.__HERDR_WORLD_RENDERER__?.ready ?? false,
    };
  });
  expect(stickyGeometry.ready).toBe(true);
  expect(Math.abs(stickyGeometry.canvasTop - stickyGeometry.stageTop)).toBeLessThanOrEqual(1);
});

async function waitForOffice(page: import("@playwright/test").Page) {
  await expect
    .poll(() => page.evaluate(() => window.__HERDR_WORLD_RENDERER__?.ready ?? false))
    .toBe(true);
  await expect(page.locator("canvas[data-office-canvas='true']")).toHaveCount(1);
}

async function webGlRenderer(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const context = document.createElement("canvas").getContext("webgl2");
    const extension = context?.getExtension("WEBGL_debug_renderer_info");
    return context && extension
      ? String(context.getParameter(extension.UNMASKED_RENDERER_WEBGL))
      : null;
  });
}

async function browserRssMiB(session: import("@playwright/test").CDPSession) {
  const response = await session.send("SystemInfo.getProcessInfo") as {
    processInfo: Array<{ id: number }>;
  };
  let rssKiB = 0;
  for (const { id } of response.processInfo) {
    try {
      const status = await readFile(`/proc/${id}/status`, "utf8");
      const match = /^VmRSS:\s+(\d+)\s+kB$/imu.exec(status);
      rssKiB += match ? Number(match[1]) : 0;
    } catch {
      // Short-lived Chromium utility processes may exit between CDP and /proc reads.
    }
  }
  return rssKiB / 1_024;
}
