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
) {
  const targets = (await (
    await fetch(`http://127.0.0.1:${port}/json/list`)
  ).json()) as { type: string; webSocketDebuggerUrl: string }[];
  const socket = new WebSocket(
    targets.find((target) => target.type === "page")!.webSocketDebuggerUrl,
  );
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error("Capture connection failed"));
  });
  let nextId = 0;
  const pending = new Map<
    number,
    { resolve(value: any): void; reject(error: Error): void }
  >();
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data)),
      request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  };
  const command = (method: string, params = {}) =>
    new Promise<any>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  await mkdir(directory, { recursive: true });
  const receipts = [];
  try {
    for (const viewport of resumeViewports) {
      await command("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: viewport.name === "phone",
      });
      await command("Runtime.evaluate", {
        expression: "new Promise(resolve => setTimeout(resolve, 600))",
        awaitPromise: true,
      });
      const actual = await command("Runtime.evaluate", {
        expression: "({ width: innerWidth, height: innerHeight })",
        returnByValue: true,
      });
      if (
        actual.result.value.width !== viewport.width ||
        actual.result.value.height !== viewport.height
      )
        throw new Error(`Viewport mismatch: ${viewport.name}`);
      const screenshot = await command("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
      });
      const filename = `${state}-${viewport.name}.png`;
      await Bun.write(
        join(directory, filename),
        Buffer.from(screenshot.data, "base64"),
      );
      receipts.push({ ...viewport, state, filename });
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
    await command("Emulation.clearDeviceMetricsOverride");
    socket.close();
  }
}
