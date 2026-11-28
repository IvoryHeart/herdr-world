import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type CaptureCommand,
  type CaptureOptions,
  captureScene,
  resizeCapture,
} from "./captureScene";
import { resumeViewports } from "./resumeVisualCapture";

/**
 * The five resume viewports of a synthetic fixture, captured on a page the
 * test already holds (a shared-Chrome case), never a user's browser.
 */
export async function captureResumeViewportsOnPage(
  command: CaptureCommand,
  directory: string,
  state: string,
  options: Pick<CaptureOptions, "view" | "content" | "timeoutMs"> = {},
) {
  await mkdir(directory, { recursive: true });
  const receipts = [];
  try {
    for (const viewport of resumeViewports) {
      await resizeCapture(command, viewport.width, viewport.height);
      const screenshot = await captureScene(command, {
        ...viewport,
        ...options,
      });
      const filename = `${state}-${viewport.name}.png`;
      await Bun.write(join(directory, filename), screenshot.bytes);
      receipts.push({
        ...viewport,
        state,
        filename,
        receipt: screenshot.receipt,
        sanity: screenshot.sanity,
      });
    }
    await Bun.write(
      join(directory, `${state}.json`),
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          browser: await command("Browser.getVersion"),
          receipts,
        },
        null,
        2,
      ),
    );
  } finally {
    await command("Runtime.evaluate", {
      expression: "window.__HERDR_WORLD_CAPTURE__?.invalidate()",
    }).catch(() => {});
    await command("Emulation.clearDeviceMetricsOverride").catch(() => {});
  }
}
