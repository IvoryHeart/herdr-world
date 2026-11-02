import { expect, test } from "bun:test";
import { townCanvasCases } from "../town/TownCanvas.cases";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  waitForBrowserFixture,
  withBrowserDeadline,
} from "../../browserChrome";
import { connectCapture } from "./connectCapture";
import { chromeRenderingFlags } from "./chromeRendering";

const chrome =
  Bun.env.CHROME_BIN ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : Bun.which("google-chrome") || Bun.which("chromium"));

const unavailableObservability = {
  health: "unavailable",
  providerId: null,
  sourceCount: 0,
  configuredSourceCount: 0,
  failedSourceCount: 0,
  observedAt: 0,
  windowSeconds: null,
  models: [],
  totalCostUsd: null,
  totalUsage: 0,
};

export function registerTownCanvasCases(group: keyof typeof townCanvasCases) {
  test.skipIf(!chrome).each(townCanvasCases[group])(
    "the Office town renders, queues blocked agents and zooms into rooms at %ipx by %ipx (%s, %ims zoom frames)",
    async (width, height, scale, flightFrameDelay) => {
      const dir = await mkdtemp(join(tmpdir(), "office-town-test-"));
      const assets = new Map<string, Blob>();
      const result = Promise.withResolvers<unknown>();
      const pageRequested = Promise.withResolvers<void>();
      const diagnosticRoot = Bun.env.HERDR_WORLD_TOWN_DIAGNOSTIC_DIR;
      const diagnosticDir = diagnosticRoot && join(diagnosticRoot, group);
      let rawResult = "";
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const path = new URL(request.url).pathname;
          if (path === "/") pageRequested.resolve();
          if (path === "/release-witness" && diagnosticDir) {
            await writeFile(
              join(diagnosticDir, `${width}x${height}.releases.json`),
              await request.text(),
              { mode: 0o600 },
            );
            return new Response("ok");
          }
          if (path === "/result" && request.method === "POST") {
            rawResult = await request.text();
            result.resolve(JSON.parse(rawResult));
            return new Response("ok");
          }
          if (path.startsWith("/api/world/observability"))
            return Response.json(unavailableObservability);
          const asset = assets.get(path);
          if (asset) return new Response(asset);
          if (path === "/")
            return new Response(
              '<head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/TownCanvas.browser.css"></head><body><script type="module" src="/TownCanvas.browser.js"></script></body>',
              { headers: { "Content-Type": "text/html" } },
            );
          return new Response("Not found", { status: 404 });
        },
      });
      const exactViewport = group === "bus";
      const fixtureUrl = `${server.url.href}?mode=test&scale=${scale}&flightFrameDelay=${flightFrameDelay}&edgeFrameDelay=${width === 390 && height === 844 && scale === "extended" ? 300 : 0}${exactViewport ? `&width=${width}&height=${height}` : ""}${diagnosticDir ? "&releaseWitness=1" : ""}`;
      let browser: ReturnType<typeof Bun.spawn> | undefined;
      let capture: Awaited<ReturnType<typeof connectCapture>> | undefined;
      let stderrDone: Promise<void> | undefined;
      try {
        const build = await Bun.build({
          entrypoints: [
            join(import.meta.dir, "../town/TownCanvas.browser.tsx"),
          ],
          outdir: dir,
          target: "browser",
        });
        expect(build.success).toBe(true);
        for (const output of build.outputs)
          assets.set(`/${basename(output.path)}`, output);
        if (diagnosticDir) {
          await mkdir(diagnosticDir, { recursive: true, mode: 0o700 });
          await writeFile(
            join(diagnosticDir, `${width}x${height}.build.json`),
            JSON.stringify({
              bun: Bun.version,
              outputs: await Promise.all(
                build.outputs.map(async (output) => ({
                  name: basename(output.path),
                  sha256: createHash("sha256")
                    .update(new Uint8Array(await output.arrayBuffer()))
                    .digest("hex"),
                })),
              ),
            }),
            { mode: 0o600 },
          );
        }
        const browserLog = join(dir, "browser.log");
        const child = Bun.spawn(
          [
            chrome!,
            "--headless=new",
            ...(exactViewport ? ["--remote-debugging-port=0"] : []),
            `--window-size=${width},${height}`,
            "--enable-webgl",
            ...(await chromeRenderingFlags(chrome!)),
            "--disable-background-networking",
            "--no-first-run",
            "--no-default-browser-check",
            `--user-data-dir=${join(dir, "profile")}`,
            exactViewport ? "about:blank" : fixtureUrl,
          ],
          {
            stdout: "ignore",
            stderr: exactViewport ? "pipe" : Bun.file(browserLog),
          },
        );
        browser = child;
        if (exactViewport) {
          const port = Promise.withResolvers<string>();
          stderrDone = (async () => {
            let output = "",
              found = false;
            for await (const bytes of child.stderr as ReadableStream<Uint8Array>) {
              output += new TextDecoder().decode(bytes);
              const match =
                !found &&
                /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(
                  output,
                );
              if (match) {
                found = true;
                port.resolve(match[1]!);
              }
            }
            await Bun.write(browserLog, output);
            if (!found)
              port.reject(new Error("Town browser exited before CDP startup"));
          })();
          capture = await connectCapture(
            await withBrowserDeadline(
              port.promise,
              "Town browser CDP startup",
              20000,
            ),
          );
          await capture.command("Emulation.setDeviceMetricsOverride", {
            width,
            height,
            deviceScaleFactor: 1,
            mobile: width < 640,
          });
          await capture.command("Page.navigate", { url: fixtureUrl });
        }
        const failures = await waitForBrowserFixture(
          pageRequested.promise,
          result.promise,
          browser.exited.then(async (code) => {
            await stderrDone;
            throw new Error(
              `Browser exited (${code}): ${await readFile(browserLog, "utf8")}`,
            );
          }),
          "Office town browser check",
          // Extended towns at large windows paint far more pixels in software.
          scale === "extended" || scale === "protected" ? 80_000 : 40_000,
        );
        if (diagnosticDir) {
          const path = join(diagnosticDir, `${width}x${height}.result.json`);
          await writeFile(path, rawResult, { mode: 0o600 });
          console.info(
            `Town raw result ${path} sha256=${createHash("sha256").update(rawResult).digest("hex")}`,
          );
        }
        expect(failures).toEqual([]);
      } finally {
        capture?.close();
        if (browser) {
          browser.kill();
          await browser.exited;
          await stderrDone;
        }
        server.stop(true);
        await rm(dir, { recursive: true, force: true });
      }
    },
    95_000 + BROWSER_STARTUP_TIMEOUT_MS,
  );
}
