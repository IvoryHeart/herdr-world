// @world-browser-suite
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { withBrowserDeadline } from "../browserChrome";
import {
  chromeBinary as chrome,
  type ChromePage,
  openChromePage,
} from "../testing/sharedChrome";
import { worldBrowserBundle } from "./testing/worldBrowserBundle";
import { captureResumeViewportsOnPage } from "./testing/resumeCaptureOnPage";
import { resumeViewports } from "./testing/resumeVisualCapture";

test.skipIf(!chrome)(
  "Reception answer controls preserve uncertainty, exact duplicate decisions and five viewport layouts",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "answer-ui-")),
      ready = Promise.withResolvers<void>();
    const { assets } = await worldBrowserBundle("AnswerDeliveries");
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/ready") {
          ready.resolve();
          return new Response("ok");
        }
        const asset = assets.get(path);
        if (asset) return new Response(asset);
        return new Response(
          '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><link rel="stylesheet" href="/AnswerDeliveries.browser.css"><script type="module" src="/AnswerDeliveries.browser.js"></script>',
          { headers: { "content-type": "text/html" } },
        );
      },
    });
    let page: ChromePage | undefined;
    try {
      // Pixels only when the optional captures are taken.
      page = await openChromePage({
        viewport: { width: 1280, height: 900 },
        pixels: !!Bun.env.WORLD_ANSWER_CAPTURE_DIR,
      });
      const { command } = page;
      const evaluate = async (expression: string) => ({
        value: await page!.evaluate(expression),
      });
      await page.command("Page.navigate", { url: server.url.href });
      await withBrowserDeadline(
        ready.promise,
        "Reception fixture ready",
        20000,
      );
      for (const viewport of resumeViewports) {
        await command("Emulation.setDeviceMetricsOverride", {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          mobile: viewport.name === "phone",
        });
        const result = await evaluate(
          "new Promise(resolve => requestAnimationFrame(() => resolve({width:innerWidth, scroll:document.documentElement.scrollWidth, cards:document.querySelectorAll('.answer-delivery').length, rail:document.querySelector('.needs-you-outbox')?.textContent})))",
        );
        expect(result.value.width).toBe(viewport.width);
        expect(result.value.scroll).toBeLessThanOrEqual(viewport.width);
        expect(result.value.cards).toBe(0);
        expect(result.value.rail).toContain("2 to check · 1 waiting");
      }
      if (Bun.env.WORLD_ANSWER_CAPTURE_DIR) {
        for (const state of ["rail", "summary", "confirm", "waiting"]) {
          await evaluate(
            `window.answerDeliveryScene(${JSON.stringify(state)})`,
          );
          await captureResumeViewportsOnPage(
            command,
            Bun.env.WORLD_ANSWER_CAPTURE_DIR,
            state,
            { view: "town", content: { selector: ".town-building-sign" } },
          );
        }
      }
      for (const viewport of resumeViewports) {
        await command("Emulation.setDeviceMetricsOverride", {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          mobile: viewport.name === "phone",
        });
        const result = await evaluate("window.answerDeliveryChecks()");
        expect(result.value).toEqual([]);
      }
    } finally {
      await page?.close();
      await server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
  90000,
);
