import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FrameDecoder, FrameKind } from "../../../server/src/herdr-core/wire";
import type { CoreTerminalPush } from "../coreWatch";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  stopChrome,
  waitForBrowserFixture,
  waitForChromePort,
} from "../browserChrome";
import { buildWorldBrowserBundle } from "./testing/browserBundles";
import { connectCapture } from "./testing/connectCapture";

const chrome =
  Bun.env.CHROME_BIN ||
  Bun.which("google-chrome") ||
  Bun.which("chromium") ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : undefined);

/** The repository's standard capture viewports. */
const VIEWPORTS = [
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "laptop", width: 1512, height: 982, mobile: false },
  { name: "wide", width: 2560, height: 1440, mobile: false },
  { name: "half", width: 1280, height: 1440, mobile: false },
  { name: "portrait", width: 1440, height: 2560, mobile: false },
] as const;

/**
 * What World's relay pushes for the recorded real-core watch: each frame on
 * the watch channel, in order (RESIZE as a grid, DATA as bytes).
 */
function recordedPushes(): CoreTerminalPush[] {
  const recording: { connections: Array<{ inbound: string[] }> } = JSON.parse(
    readFileSync(
      join(
        import.meta.dir,
        "../../../server/src/herdr-core/testing/recorded/core-0.1.20-watch.json",
      ),
      "utf8",
    ),
  );
  const bytes = Buffer.concat(
    recording.connections[0]!.inbound.map((b) => Buffer.from(b, "base64")),
  );
  const frames = new FrameDecoder().push(
    new Uint8Array(bytes.subarray(bytes.indexOf(0x0a) + 1)),
  );
  return frames.flatMap((f): CoreTerminalPush[] => {
    if (f.channel === 0) return [];
    if (f.kind === FrameKind.RESIZE) {
      const view = new DataView(f.payload.buffer, f.payload.byteOffset, 4);
      return [
        {
          stream: "",
          grid: {
            cols: view.getUint16(0, true),
            rows: view.getUint16(2, true),
          },
        },
      ];
    }
    return f.kind === FrameKind.DATA
      ? [{ stream: "", bytes: Buffer.from(f.payload).toString("base64") }]
      : [];
  });
}

test.skipIf(!chrome)(
  "a core terminal adopts core's grid, rescales on rotation, and takes World's size only while you type",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "core-watch-"));
    const { assets } = await buildWorldBrowserBundle("CoreTerminalWatch", dir);
    const pushes = JSON.stringify(recordedPushes());
    let result = Promise.withResolvers<string[]>();
    let requested = Promise.withResolvers<void>();
    let connection: Awaited<ReturnType<typeof connectCapture>> | undefined;
    let mobile = true;
    const uploads: Array<{ path: string; generation: string | null }> = [];
    /** CDP key presses: real, trusted events into the focused element. */
    const KEYS: Record<string, { code: string; vk: number; text?: string }> = {
      a: { code: "KeyA", vk: 65, text: "a" },
      Escape: { code: "Escape", vk: 27 },
    };
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const path = url.pathname;
        if (path === "/result") {
          result.resolve(await request.json());
          return new Response("ok");
        }
        if (path === "/pushes") return new Response(pushes);
        if (path === "/key") {
          const key = url.searchParams.get("key")!;
          const { code, vk, text } = KEYS[key]!;
          for (const type of ["keyDown", "keyUp"] as const)
            await connection!.command("Input.dispatchKeyEvent", {
              type: type === "keyDown" && text ? "keyDown" : type,
              key,
              code,
              windowsVirtualKeyCode: vk,
              ...(type === "keyDown" && text ? { text } : {}),
            });
          return new Response("ok");
        }
        if (path === "/insert") {
          await connection!.command("Input.insertText", {
            text: url.searchParams.get("text") ?? "",
          });
          return new Response("ok");
        }
        if (path === "/uploads") return Response.json(uploads);
        if (path.startsWith("/api/connections/")) {
          // The core connection's upload route, as World's listener answers.
          await request.arrayBuffer();
          const generation = url.searchParams.get("connection_generation");
          uploads.push({ path, generation });
          return Response.json(
            { path: "/tmp/herdr-world-uploads-example/shot.png" },
            {
              headers: {
                "X-Herdr-Connection-Id": "core-fixture",
                "X-Herdr-Connection-Generation": String(generation),
              },
            },
          );
        }
        if (path === "/viewport") {
          await connection!.command("Emulation.setDeviceMetricsOverride", {
            width: Number(url.searchParams.get("width")),
            height: Number(url.searchParams.get("height")),
            deviceScaleFactor: 1,
            mobile,
          });
          return new Response("ok");
        }
        if (path === "/") requested.resolve();
        const asset =
          path === "/"
            ? Bun.file(join(dir, "CoreTerminalWatch/index.html"))
            : assets.get(path);
        return asset
          ? new Response(asset)
          : new Response("Not found", { status: 404 });
      },
    });
    let child: ReturnType<typeof Bun.spawn> | undefined;
    try {
      const profile = join(dir, "profile"),
        log = join(dir, "chrome.log");
      child = Bun.spawn(
        [
          chrome!,
          "--headless=new",
          "--disable-gpu",
          "--remote-debugging-port=0",
          "--window-size=390,844",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${profile}`,
          "about:blank",
        ],
        { stdout: "ignore", stderr: Bun.file(log) },
      );
      const exited = child.exited.then(async (code) => {
        throw new Error(`Chrome exited ${code}: ${await Bun.file(log).text()}`);
      });
      connection = await connectCapture(
        await waitForChromePort(child, profile, log),
      );
      await connection.command("Emulation.setDeviceMetricsOverride", {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await connection.command("Page.navigate", { url: server.url.href });
      expect(
        await waitForBrowserFixture(
          requested.promise,
          result.promise,
          exited,
          "Core terminal watch",
          BROWSER_STARTUP_TIMEOUT_MS,
        ),
      ).toEqual([]);
      // Evidence captures for the PR, only when asked for.
      const captures = Bun.env.HERDR_WORLD_CORE_CAPTURES;
      if (!captures) return;
      await mkdir(captures, { recursive: true });
      for (const scene of ["watch", "typing"] as const)
        for (const theme of ["light", "dark"] as const)
          for (const viewport of VIEWPORTS) {
            mobile = viewport.mobile;
            await connection.command("Emulation.setDeviceMetricsOverride", {
              width: viewport.width,
              height: viewport.height,
              deviceScaleFactor: 1,
              mobile: viewport.mobile,
            });
            result = Promise.withResolvers<string[]>();
            requested = Promise.withResolvers<void>();
            await connection.command("Page.navigate", {
              url: `${server.url.href}?capture=${scene}`,
            });
            expect(
              await waitForBrowserFixture(
                requested.promise,
                result.promise,
                exited,
                "Core terminal watch",
                BROWSER_STARTUP_TIMEOUT_MS,
              ),
            ).toEqual([]);
            await connection.command("Runtime.evaluate", {
              expression: `document.documentElement.dataset.theme = ${JSON.stringify(theme)}; new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`,
              awaitPromise: true,
            });
            const shot = await connection.command("Page.captureScreenshot", {
              format: "png",
            });
            await writeFile(
              join(captures, `${scene}-${viewport.name}-${theme}.png`),
              Buffer.from(shot.data, "base64"),
            );
          }
    } finally {
      connection?.close();
      await stopChrome(child);
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  120000,
);
