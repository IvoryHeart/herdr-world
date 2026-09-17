import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const chrome =
  Bun.env.CHROME_BIN ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : Bun.which("google-chrome") || Bun.which("chromium"));

test.skipIf(!chrome).each([1280, 390])(
  "the retained Pixel Office preserves its complete responsive scene at %ipx",
  async (width) => {
    const dir = await mkdtemp(join(tmpdir(), "pixel-office-test-"));
    const assets = new Map<string, Blob>();
    const result = Promise.withResolvers<unknown>();
    const snapshotGate = Promise.withResolvers<void>();
    const publicDir = join(import.meta.dir, "..", "..", "public");
    let metricsEndpoint: string | null = "http://metrics.example.test/";
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/result" && request.method === "POST") {
          result.resolve(await request.json());
          return new Response("ok");
        }
        if (path === "/release-metrics" && request.method === "POST") {
          snapshotGate.resolve();
          return new Response("ok");
        }
        if (path === "/api/world/observability/snapshot") {
          await snapshotGate.promise;
          return Response.json(
            metricsEndpoint
              ? {
                  health: "available",
                  providerId: "prometheus.otel",
                  sourceCount: 1,
                  configuredSourceCount: 1,
                  failedSourceCount: 0,
                  observedAt: 1_700_000_000_000,
                  windowSeconds: 86_400,
                  models: [
                    {
                      provider: "openai",
                      model: "gpt-example",
                      usage: { input: 120, output: 30 },
                      costUsd: null,
                      costKind: null,
                    },
                  ],
                  totalCostUsd: null,
                  totalUsage: 150,
                }
              : {
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
                },
          );
        }
        if (path === "/api/world/observability/configuration") {
          if (request.method === "PUT") {
            const body = (await request.json()) as {
              prometheus_url: string | null;
            };
            metricsEndpoint = body.prometheus_url
              ? `${body.prometheus_url.replace(/\/+$/u, "")}/`
              : null;
          }
          return Response.json({
            providerId: metricsEndpoint ? "prometheus.otel" : "none",
            configured: metricsEndpoint !== null,
            endpoint: metricsEndpoint,
            source: "settings",
            health: metricsEndpoint ? "available" : "unavailable",
            healthReason: null,
            observedAt: metricsEndpoint ? 1_700_000_000_000 : 0,
            lastSuccessAt: metricsEndpoint ? 1_700_000_000_000 : null,
          });
        }
        const asset = assets.get(path);
        if (asset) return new Response(asset);
        if (path.startsWith("/world/characters/")) {
          const file = Bun.file(join(publicDir, path.slice(1)));
          if (await file.exists()) return new Response(file);
        }
        if (path === "/") {
          return new Response(
            '<head><link rel="stylesheet" href="/PixelOfficeCanvas.browser.css"></head><body><script type="module" src="/PixelOfficeCanvas.browser.js"></script></body>',
            { headers: { "Content-Type": "text/html" } },
          );
        }
        return new Response("Not found", { status: 404 });
      },
    });
    let browser: ReturnType<typeof Bun.spawn> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const build = await Bun.build({
        entrypoints: [join(import.meta.dir, "PixelOfficeCanvas.browser.tsx")],
        outdir: dir,
        target: "browser",
      });
      expect(build.success).toBe(true);
      for (const output of build.outputs) {
        assets.set(`/${basename(output.path)}`, output);
      }
      const browserLog = join(dir, "browser.log");
      browser = Bun.spawn(
        [
          chrome!,
          "--headless=new",
          `--window-size=${width},900`,
          "--enable-webgl",
          "--use-angle=swiftshader",
          "--enable-unsafe-swiftshader",
          "--disable-background-networking",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${join(dir, "profile")}`,
          server.url.href,
        ],
        { stdout: "ignore", stderr: Bun.file(browserLog) },
      );
      const failures = await Promise.race([
        result.promise,
        browser.exited.then(async (code) => {
          throw new Error(
            `Browser exited (${code}): ${await readFile(browserLog, "utf8")}`,
          );
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Pixel Office browser check timed out")),
            30_000,
          );
        }),
      ]);
      expect(failures).toEqual([]);
    } finally {
      clearTimeout(timer);
      if (browser) {
        browser.kill();
        await browser.exited;
      }
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  45_000,
);
