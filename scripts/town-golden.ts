import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import pin from "../tools/chrome/test-chrome.json";
import { SWIFTSHADER_FLAGS } from "../web/src/world/testing/chromeRendering";

/** Same five sizes as the existing PR capture helper (resumeVisualCapture). */
export const townGoldenViewports = [
  { name: "phone", width: 390, height: 844 },
  { name: "mac-laptop", width: 1512, height: 982 },
  { name: "linux-half", width: 1280, height: 1440 },
  { name: "linux-wide", width: 2560, height: 1440 },
  { name: "portrait", width: 1440, height: 2560 },
];
const root = resolve(import.meta.dir, "..");
const fixture = join(root, "web/src/world/testing/town-golden");
const goldenDirectory = join(fixture, "images");

/** A request/event connection; every operation has a deadline, never a status loop. */
class Cdp {
  private next = 0;
  private pending = new Map<
    number,
    {
      resolve(value: any): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(private socket: WebSocket) {
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    };
    socket.onclose = () => this.close();
  }
  static async connect(url: string) {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("CDP connection timed out"));
      }, 10_000);
      socket.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error("CDP connection failed"));
      };
    });
    return new Cdp(socket);
  }
  command(method: string, params = {}, sessionId?: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timed out: ${method}`));
      }, 90_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  close() {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("CDP closed"));
    }
    this.pending.clear();
    this.socket.close();
  }
}

async function endpoint(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const ready = Promise.withResolvers<string>();
  const timer = setTimeout(
    () => ready.reject(new Error("Chrome startup timed out")),
    35_000,
  );
  void (async () => {
    let log = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          ready.reject(new Error("Chrome exited before CDP was ready"));
          break;
        }
        log = (log + new TextDecoder().decode(value)).slice(-4000);
        const address = /DevTools listening on (ws:\/\/[^\s]+)/.exec(log)?.[1];
        if (address) ready.resolve(address);
      }
    } catch (error) {
      ready.reject(error);
    }
  })();
  try {
    return await ready.promise;
  } finally {
    clearTimeout(timer);
  }
}

export async function runTownGolden(options: {
  chrome: string;
  directory: string;
  runs?: number;
  update?: boolean;
}) {
  const runs = options.runs ?? 1;
  if (!Number.isInteger(runs) || runs < 1 || runs > 20)
    throw new Error("Golden runs must be between 1 and 20");
  if (options.update && process.env.CI === "true")
    throw new Error("Golden updates are forbidden in CI");
  const directory = resolve(options.directory);
  if (
    directory === goldenDirectory ||
    directory.startsWith(goldenDirectory + "/")
  )
    throw new Error("Report directory must be separate from stored goldens");
  await mkdir(directory, { recursive: true });
  const scratch = await mkdtemp(join(tmpdir(), "town-golden-"));
  const assets = new Map<string, Blob>();
  const failures: string[] = [];
  const receipts: Record<string, unknown>[] = [];
  const began = performance.now();
  let browserVersion = "";
  const report = async () => {
    const result = {
      schema: 1,
      runs,
      captures: receipts.length,
      seed: "0x746f776e",
      clockStepMs: 16,
      checkpointMs: 6000,
      dpr: 1,
      tolerance: 0,
      browserVersion,
      seconds: (performance.now() - began) / 1000,
      failures,
      receipts,
    };
    await Bun.write(
      join(directory, "report.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    await Bun.write(
      join(directory, "summary.md"),
      `Town golden images: **${failures.length ? "FAIL" : "PASS"}** — ${receipts.length}/${runs * 5} captures, ${runs} run(s), zero pixel tolerance.\n\n${failures.map((f) => "- " + f).join("\n")}\n`,
    );
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/")
        return new Response(
          '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/TownGolden.browser.css"></head><body><div id="root"></div><script type="module" src="/TownGolden.browser.js"></script></body></html>',
          { headers: { "Content-Type": "text/html" } },
        );
      const asset = assets.get(path);
      return asset
        ? new Response(asset)
        : new Response("Not found", { status: 404 });
    },
  });
  try {
    const build = await Bun.build({
      entrypoints: [join(fixture, "TownGolden.browser.tsx")],
      outdir: join(scratch, "bundle"),
      target: "browser",
      loader: { ".woff2": "file" },
    });
    if (!build.success)
      throw new AggregateError(build.logs, "Golden fixture build failed");
    for (const output of build.outputs)
      assets.set("/" + basename(output.path), output);
    if (options.update) await mkdir(goldenDirectory, { recursive: true });
    for (let run = 1; run <= runs; run++) {
      const browser = Bun.spawn(
        [
          options.chrome,
          "--headless=new",
          "--remote-debugging-port=0",
          "--remote-debugging-address=127.0.0.1",
          "--enable-webgl",
          ...SWIFTSHADER_FLAGS,
          "--force-device-scale-factor=1",
          "--force-color-profile=srgb",
          "--disable-lcd-text",
          "--font-render-hinting=none",
          "--disable-background-networking",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${join(scratch, "profile-" + run)}`,
          "about:blank",
        ],
        { stdout: "ignore", stderr: "pipe" },
      );
      let cdp: Cdp | undefined;
      try {
        cdp = await Cdp.connect(await endpoint(browser.stderr));
        const version = await cdp.command("Browser.getVersion");
        browserVersion = version.product;
        if (!browserVersion.endsWith("/" + pin.version))
          throw new Error(
            `Use pinned Chrome ${pin.version}; received ${browserVersion}`,
          );
        for (const viewport of townGoldenViewports) {
          const { targetId } = await cdp.command("Target.createTarget", {
            url: "about:blank",
          });
          try {
            const { sessionId } = await cdp.command("Target.attachToTarget", {
              targetId,
              flatten: true,
            });
            const command = (method: string, params = {}) =>
              cdp!.command(method, params, sessionId);
            await command("Emulation.setDeviceMetricsOverride", {
              width: viewport.width,
              height: viewport.height,
              deviceScaleFactor: 1,
              mobile: false,
            });
            await command("Emulation.setEmulatedMedia", {
              features: [
                { name: "prefers-reduced-motion", value: "no-preference" },
                { name: "prefers-color-scheme", value: "dark" },
              ],
            });
            // Register before navigation: no real-time sleeps or readiness polling.
            await command("Page.enable");
            await command("Runtime.enable");
            await command("Page.addScriptToEvaluateOnNewDocument", {
              source:
                'window.goldenLoaded = new Promise(resolve => addEventListener("load", resolve, { once: true }));',
            });
            await command("Page.navigate", { url: server.url.href });
            const evaluate = async (expression: string) => {
              const result = await command("Runtime.evaluate", {
                expression,
                awaitPromise: true,
                returnByValue: true,
              });
              if (result.exceptionDetails)
                throw new Error(
                  result.exceptionDetails.exception?.description ??
                    result.exceptionDetails.text,
                );
              return result.result.value;
            };
            const scene = await evaluate(
              "window.goldenLoaded.then(() => window.golden.ready)",
            );
            if (
              scene.width !== viewport.width ||
              scene.height !== viewport.height ||
              scene.dpr !== 1
            )
              throw new Error("Viewport or DPR mismatch");
            const screenshot = await command("Page.captureScreenshot", {
              format: "png",
              captureBeyondViewport: false,
              fromSurface: true,
            });
            const bytes = Buffer.from(screenshot.data, "base64");
            const name = viewport.name + ".png";
            const reference = join(goldenDirectory, name);
            await Bun.write(join(directory, name), bytes);
            if (options.update && run === 1) await Bun.write(reference, bytes);
            if (!(await Bun.file(reference).exists()))
              throw new Error(`Missing golden: ${name}`);
            const expected = Buffer.from(
              await Bun.file(reference).arrayBuffer(),
            ).toString("base64");
            const comparison = await evaluate(
              `window.golden.compare(${JSON.stringify(expected)}, ${JSON.stringify(screenshot.data)})`,
            );
            receipts.push({
              run,
              ...viewport,
              ...scene,
              changedPixels: comparison.changed,
              pngSha256: createHash("sha256").update(bytes).digest("hex"),
            });
            if (comparison.changed) {
              failures.push(
                `Run ${run}, ${viewport.name}: ${comparison.changed} pixels differ`,
              );
              await Bun.write(
                join(directory, `run-${run}-${viewport.name}.png`),
                bytes,
              );
              await Bun.write(
                join(directory, `diff-${run}-${viewport.name}.png`),
                Buffer.from(comparison.diff, "base64"),
              );
              await Bun.write(
                join(directory, `expected-${viewport.name}.png`),
                Buffer.from(expected, "base64"),
              );
            }
          } finally {
            await cdp.command("Target.closeTarget", { targetId });
          }
        }
        console.info(
          `[town-golden] run ${run}/${runs}: five viewports captured`,
        );
      } finally {
        cdp?.close();
        browser.kill();
        await browser.exited;
        await rm(join(scratch, "profile-" + run), {
          recursive: true,
          force: true,
        });
      }
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  } finally {
    server.stop(true);
    await rm(scratch, { recursive: true, force: true });
    await report();
  }
  if (failures.length) throw new Error(failures.join("\n"));
}
