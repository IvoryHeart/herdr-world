import { connectCapture } from "./connectCapture";
import {
  captureScene,
  resizeCapture,
  type CaptureOptions,
} from "./captureScene";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export const resumeViewports = [
  { name: "phone", label: "Phone", width: 390, height: 844 },
  { name: "mac-laptop", label: "Mac laptop", width: 1512, height: 982 },
  {
    name: "linux-half",
    label: "Half-width Linux window",
    width: 1280,
    height: 1440,
  },
  {
    name: "linux-wide",
    label: "Wide Linux monitor",
    width: 2560,
    height: 1440,
  },
  { name: "portrait", label: "Portrait monitor", width: 1440, height: 2560 },
];

/** Capture the running synthetic production-tree fixture; never a user's browser. */
export async function captureResumeViewports(
  port: string,
  directory: string,
  state: string,
  options: Pick<CaptureOptions, "view" | "content" | "timeoutMs"> = {},
) {
  const { command, close } = await connectCapture(port);
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
    try {
      await command("Runtime.evaluate", {
        expression: "window.__HERDR_WORLD_CAPTURE__?.invalidate()",
      });
      await command("Emulation.clearDeviceMetricsOverride");
    } finally {
      close();
    }
  }
}
