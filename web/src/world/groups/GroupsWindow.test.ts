// @world-browser-suite
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  waitForBrowserFixture,
} from "../../browserChrome";
import {
  chromeBinary as chrome,
  type ChromePage,
  openChromePage,
} from "../../testing/sharedChrome";
import { groupsBrowserServer } from "./testing/groupsBrowserServer";

test.skipIf(!chrome).each([
  [1512, 982],
  [390, 844],
  [320, 900],
  [360, 900],
  [430, 900],
  [2560, 1440],
  [1280, 1440],
  [1440, 2560],
])(
  "Groups panel uses current membership and refuses stale role confirmation at %ix%ipx",
  async (width: number, height: number) => {
    const directory = await mkdtemp(join(tmpdir(), "groups-browser-"));
    const fixture = await groupsBrowserServer(directory);
    let page: ChromePage | undefined;
    try {
      // Pixels only when the optional captures are taken.
      page = await openChromePage({
        viewport: { width, height, deviceScaleFactor: 1, mobile: width <= 720 },
        touch: width <= 720,
        pixels: !!Bun.env.GROUPS_CAPTURE_DIR,
      });
      const opened = page;
      await opened.command("Emulation.setFocusEmulationEnabled", {
        enabled: true,
      });
      const requested = (async () => {
        await opened.command("Page.navigate", {
          url: `${fixture.server.url.href}?width=${width}&height=${height}${Bun.env.GROUPS_CAPTURE_DIR ? "&capture=1" : ""}`,
        });
        await fixture.requested;
      })();
      const failures = await waitForBrowserFixture(
        requested,
        fixture.result,
        page.exited,
        "Groups panel",
        20_000,
      );
      expect(failures).toEqual([]);
      if (Bun.env.GROUPS_CAPTURE_DIR) {
        await mkdir(Bun.env.GROUPS_CAPTURE_DIR, { recursive: true });
        const capture = async (name: string) => {
          const shot = await page!.command("Page.captureScreenshot", {
            format: "png",
            captureBeyondViewport: false,
          });
          await Bun.write(
            join(
              Bun.env.GROUPS_CAPTURE_DIR!,
              `groups-${name}-${width}x${height}.png`,
            ),
            Buffer.from(String(shot.data), "base64"),
          );
        };
        await capture("roster");
        const detail = await page.command("Runtime.evaluate", {
          awaitPromise: true,
          expression: `new Promise((resolve) => {
          const observer = new MutationObserver(() => { if (document.querySelector('.group-detail')) { observer.disconnect(); requestAnimationFrame(() => resolve(true)); } });
          observer.observe(document.body, { childList: true, subtree: true });
          [...document.querySelectorAll('.group-roster-row')].find((node) => node.textContent.includes('Pod · Chat')).click();
        })`,
        });
        if (detail.exceptionDetails)
          throw new Error("Groups detail capture failed");
        await capture("detail");
      }
    } finally {
      await page?.close();
      fixture.server.stop(true);
      await rm(directory, { recursive: true, force: true });
    }
  },
  30_000 + BROWSER_STARTUP_TIMEOUT_MS,
);
