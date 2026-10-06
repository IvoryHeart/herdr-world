import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  waitForBrowserFixture,
} from "../browserChrome";

const chrome =
  Bun.env.CHROME_BIN ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : Bun.which("google-chrome") || Bun.which("chromium"));

test.skipIf(!chrome)(
  "World keeps navigator, managed windows, and terminal identities aligned",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "world-terminal-handoff-"));
    const assets = new Map<string, Blob>();
    const captureDir = Bun.env.WORLD_WINDOW_CAPTURE_DIR;
    const result = Promise.withResolvers<unknown>();
    const publicDir = join(import.meta.dir, "..", "..", "public");
    const pageRequested = Promise.withResolvers<void>();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/office") pageRequested.resolve();
        if (path === "/result" && request.method === "POST") {
          result.resolve(await request.json());
          return new Response("ok");
        }
        if (path === "/capture/desktop" || path === "/capture/mobile") {
          if (captureDir) {
            const [port] = (
              await readFile(join(dir, "profile", "DevToolsActivePort"), "utf8")
            ).split("\n");
            const targets = (await (
              await fetch(`http://127.0.0.1:${port}/json/list`)
            ).json()) as { type: string; webSocketDebuggerUrl: string }[];
            const target = targets.find((target) => target.type === "page")!;
            const socket = new WebSocket(target.webSocketDebuggerUrl);
            await new Promise<void>((resolve, reject) => {
              socket.onopen = () => resolve();
              socket.onerror = () =>
                reject(new Error("Screenshot browser connection failed"));
            });
            let id = 0;
            const command = (
              method: string,
              params: Record<string, unknown> = {},
            ) =>
              new Promise<Record<string, string>>((resolve, reject) => {
                const current = ++id;
                const receive = (event: MessageEvent) => {
                  const message = JSON.parse(String(event.data));
                  if (message.id !== current) return;
                  socket.removeEventListener("message", receive);
                  if (message.error) reject(new Error(message.error.message));
                  else resolve(message.result);
                };
                socket.addEventListener("message", receive);
                socket.send(JSON.stringify({ id: current, method, params }));
              });
            try {
              if (path.endsWith("mobile")) {
                await command("Emulation.setDeviceMetricsOverride", {
                  width: 390,
                  height: 844,
                  deviceScaleFactor: 1,
                  mobile: false,
                });
                await Bun.sleep(200);
              }
              const screenshot = await command("Page.captureScreenshot", {
                format: "png",
              });
              await Bun.write(
                join(captureDir, `${path.split("/").pop()}.png`),
                Buffer.from(screenshot.data!, "base64"),
              );
              if (path.endsWith("mobile")) {
                await command("Emulation.clearDeviceMetricsOverride");
                await Bun.sleep(200);
              }
            } finally {
              socket.close();
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
          '<head><link rel="stylesheet" href="/WorldTerminalHandoff.browser.css"></head><body><script type="module" src="/WorldTerminalHandoff.browser.js"></script></body>',
          { headers: { "Content-Type": "text/html" } },
        );
      },
    });
    let browser: ReturnType<typeof Bun.spawn> | undefined;
    try {
      const build = await Bun.build({
        entrypoints: [
          join(import.meta.dir, "WorldTerminalHandoff.browser.tsx"),
        ],
        outdir: dir,
        target: "browser",
        plugins: [
          {
            name: "short-created-pane-deadline",
            setup(builder) {
              builder.onLoad(
                { filter: /officeRoomActions\.ts$/ },
                async (args) => {
                  const source = await Bun.file(args.path).text();
                  const declaration =
                    /export const CREATED_PANE_ADMISSION_TIMEOUT_MS = 21_000;/;
                  if (!declaration.test(source)) {
                    throw new Error(
                      "Created-pane deadline declaration changed",
                    );
                  }
                  // The real 21-second policy is covered by officeRoomActions.test.ts.
                  // This browser case verifies deadline cleanup without a real wait.
                  return {
                    contents: source.replace(
                      declaration,
                      "export const CREATED_PANE_ADMISSION_TIMEOUT_MS = 1_000;",
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
      expect(build.success).toBe(true);
      for (const output of build.outputs) {
        assets.set(`/${basename(output.path)}`, output);
      }
      const browserLog = join(dir, "browser.log");
      browser = Bun.spawn(
        [
          chrome!,
          "--headless=new",
          ...(captureDir ? ["--remote-debugging-port=0"] : []),
          "--window-size=1440,1000",
          "--enable-webgl",
          "--use-angle=swiftshader",
          "--enable-unsafe-swiftshader",
          "--disable-dev-shm-usage",
          "--disable-background-networking",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${join(dir, "profile")}`,
          `${server.url.href}office`,
        ],
        { stdout: "ignore", stderr: Bun.file(browserLog) },
      );
      const observed = await waitForBrowserFixture(
        pageRequested.promise,
        result.promise,
        browser.exited.then(async (code) => {
          throw new Error(
            `Browser exited (${code}): ${await readFile(browserLog, "utf8")}`,
          );
        }),
        "World terminal handoff",
        120_000,
      );
      if (Array.isArray(observed) && observed.length)
        console.info("World handoff failure detail", JSON.stringify(observed));
      expect(observed).toEqual([]);
    } finally {
      browser?.kill();
      if (browser) await browser.exited;
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  150_000 + BROWSER_STARTUP_TIMEOUT_MS,
);
