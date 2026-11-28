import { captureScene, resizeCapture } from "./testing/captureScene";
import { captureResumeViewportsOnPage } from "./testing/resumeCaptureOnPage";
import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { assetUrlImports } from "./testing/assetUrlImports";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  waitForBrowserFixture,
} from "../browserChrome";
import { casePhases } from "./testing/casePhases";
import {
  chromeBinary as chrome,
  openChromePage,
  type ChromePage,
} from "../testing/sharedChrome";

// Every case loads the same bundle: build it once per test process.
let bundleDirectory: Promise<string> | undefined;
let bundle: ReturnType<typeof Bun.build> | undefined;
afterAll(async () => {
  if (bundleDirectory)
    await rm(await bundleDirectory, { recursive: true, force: true });
});
function handoffBuild() {
  bundle ??= build();
  return bundle;
}
async function build() {
  return Bun.build({
    entrypoints: [join(import.meta.dir, "WorldTerminalHandoff.browser.tsx")],
    outdir: await (bundleDirectory ??= mkdtemp(
      join(tmpdir(), "world-terminal-handoff-bundle-"),
    )),
    target: "browser",
    define: { __HERDR_WORLD_VERSION__: JSON.stringify("9.8.7-test") },
    plugins: [
      assetUrlImports,
      {
        name: "created-opener-completion",
        setup(builder) {
          builder.onLoad(
            { filter: /useWorldCreatedTerminal\.ts$/ },
            async (args) => {
              const source = await Bun.file(args.path).text();
              if (source.split("await opening;").length !== 2)
                throw new Error("Created-terminal opener completion changed");
              return {
                contents:
                  'import { createdOpenerCompleted } from "./testing/handoffAdmissionClock";\n' +
                  source.replace(
                    "await opening;",
                    "try { await opening; } finally { createdOpenerCompleted(node.id); }",
                  ),
                loader: "ts",
              };
            },
          );
        },
      },
      {
        name: "vite-raw-svg",
        setup(builder) {
          builder.onResolve({ filter: /\.svg\?raw$/ }, (args) => ({
            path: Bun.resolveSync(
              args.path.slice(0, -"?raw".length),
              dirname(args.importer),
            ),
            namespace: "vite-raw-svg",
          }));
          builder.onLoad(
            { filter: /.*/, namespace: "vite-raw-svg" },
            async (args) => ({
              contents: `export default ${JSON.stringify(await Bun.file(args.path).text())}`,
              loader: "js",
            }),
          );
        },
      },
    ],
  });
}

test
  .skipIf(!chrome)
  .each([
    "shell",
    "windows",
    "admission",
    "resources",
    "resume",
    "authority",
    "shared-inspector",
  ])(
  "rendering, focus, geometry and terminal lifecycle: World navigator and managed windows (%s)",
  async (scenario) => {
    const phases = casePhases(`WorldTerminalHandoff ${scenario}`);
    const dir = await mkdtemp(join(tmpdir(), "world-terminal-handoff-"));
    const assets = new Map<string, Blob>();
    const captureDir = Bun.env.WORLD_WINDOW_CAPTURE_DIR;
    const resumeCaptureDir = Bun.env.WORLD_RESUME_CAPTURE_DIR;
    const result = Promise.withResolvers<unknown>();
    const publicDir = join(import.meta.dir, "..", "..", "public");
    const pageRequested = Promise.withResolvers<void>();
    let browser: ChromePage | undefined;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/town") pageRequested.resolve();
        if (
          path === "/api/connections/local/terminal-upload" &&
          request.method === "POST"
        ) {
          const url = new URL(request.url);
          if (
            url.searchParams.get("filename") !== "example.txt" ||
            (await request.text()) !== "example upload"
          )
            return new Response("Unexpected upload payload", { status: 400 });
          return Response.json(
            { path: "/tmp/example.txt" },
            {
              headers: {
                "X-Herdr-Connection-Id": "local",
                "X-Herdr-Connection-Generation":
                  url.searchParams.get("connection_generation") ?? "",
              },
            },
          );
        }

        if (path === "/result" && request.method === "POST") {
          result.resolve(await request.json());
          return new Response("ok");
        }
        if (
          path === "/capture/resume-disconnected" ||
          path === "/capture/resume-recovery"
        ) {
          if (resumeCaptureDir) {
            await captureResumeViewportsOnPage(
              browser!.command,
              resumeCaptureDir,
              path.endsWith("disconnected") ? "disconnected" : "recovery",
              {
                view: "board",
                content: {
                  selector:
                    ".workspace-inspector .workspace-inspector-tabs, .workspace-inspector .workspace-inspector-view-select",
                  scope: "document",
                },
              },
            );
          }
          return new Response(null, { status: 204 });
        }
        if (path === "/capture/desktop" || path === "/capture/mobile") {
          if (captureDir) {
            const command = browser!.command;
            const original = await command("Runtime.evaluate", {
              expression: "({width:innerWidth,height:innerHeight})",
              returnByValue: true,
            });
            const dimensions = path.endsWith("mobile")
              ? { width: 390, height: 844 }
              : original.result.value;
            if (path.endsWith("mobile"))
              await resizeCapture(command, dimensions.width, dimensions.height);
            const screenshot = await captureScene(command, {
              ...dimensions,
              content: {
                selector:
                  ".workspace-inspector .workspace-inspector-tabs, .workspace-inspector .workspace-inspector-view-select",
                scope: "document",
              },
            });
            await Bun.write(
              join(captureDir, `${path.split("/").pop()}.png`),
              screenshot.bytes,
            );
            if (path.endsWith("mobile")) {
              await resizeCapture(
                command,
                original.result.value.width,
                original.result.value.height,
              );
              await command("Runtime.evaluate", {
                expression: `window.__HERDR_WORLD_CAPTURE__.wait(${JSON.stringify({ ...original.result.value, timeoutMs: 15000 })})`,
                awaitPromise: true,
              });
            }
          }
          return new Response(null, { status: 204 });
        }
        const asset = assets.get(path);
        if (asset) return new Response(asset);
        if (path.startsWith("/world/") || path.endsWith(".svg")) {
          const file = Bun.file(join(publicDir, path.slice(1)));
          if (await file.exists()) return new Response(file);
        }
        return new Response(
          '<head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/WorldTerminalHandoff.browser.css"></head><body><script type="module" src="/WorldTerminalHandoff.browser.js"></script></body>',
          { headers: { "Content-Type": "text/html" } },
        );
      },
    });
    try {
      const build = await handoffBuild();
      expect(build.success).toBe(true);
      for (const output of build.outputs) {
        assets.set(`/${basename(output.path)}`, output);
      }
      phases.mark("build");
      void pageRequested.promise.then(() => phases.mark("load"));
      browser = await openChromePage({
        viewport: { width: 1440, height: 1000 },
        pixels: !!(captureDir || resumeCaptureDir),
      });
      void browser
        .navigate(
          `${server.url.href}town?scenario=${scenario}${resumeCaptureDir ? "&resume-gallery" : ""}`,
        )
        .catch(() => {});
      const observed = await waitForBrowserFixture(
        pageRequested.promise,
        result.promise,
        browser.exited,
        "World terminal handoff",
        // Independent phases keep the original per-step bounds and hang guard.
        // Measured case weights schedule work; they are not runtime deadlines.
        resumeCaptureDir ? 220_000 : 180_000,
      );
      phases.mark("scene");
      if (Array.isArray(observed) && observed.length)
        console.info("World handoff failure detail", JSON.stringify(observed));
      expect(observed).toEqual([]);
    } finally {
      await browser?.close();
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
      phases.done();
    }
  },
  250_000 + BROWSER_STARTUP_TIMEOUT_MS,
);
