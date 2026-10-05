import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { InputDriver } from "./browserAcceptanceFixture";

const chrome =
  Bun.env.CHROME_BIN || Bun.which("google-chrome") || Bun.which("chromium");
test.skipIf(!chrome).each([1440, 390])(
  "shared creation owns exact sources across visual views and Spaces at %ipx",
  async (width) => {
    const dir = await mkdtemp(join(tmpdir(), "world-shared-creation-"));
    const assets = new Map<string, Blob>();
    const result = Promise.withResolvers<string[]>();
    let socket: WebSocket | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/viewport-ready") {
          const [port] = (
            await readFile(join(dir, "profile", "DevToolsActivePort"), "utf8")
          ).split("\n");
          const targets = (await (
            await fetch(`http://127.0.0.1:${port}/json/list`)
          ).json()) as { type: string; webSocketDebuggerUrl: string }[];
          socket = new WebSocket(
            targets.find((target) => target.type === "page")!
              .webSocketDebuggerUrl,
          );
          await new Promise<void>((resolve, reject) => {
            socket!.onopen = () => resolve();
            socket!.onerror = () => reject(new Error("CDP connection failed"));
          });
          const driver = new InputDriver(socket);
          await driver.call("Emulation.setDeviceMetricsOverride", {
            width,
            height: width === 390 ? 844 : 1000,
            deviceScaleFactor: 1,
            mobile: width === 390,
          });
          await driver.call("Emulation.setTouchEmulationEnabled", {
            enabled: width === 390,
          });
          return new Response(String(width));
        }
        if (path === "/result") {
          result.resolve(await request.json());
          return new Response("ok");
        }
        const asset = assets.get(path);
        if (asset) return new Response(asset);
        if (path.startsWith("/world/") || path.endsWith(".svg")) {
          const file = Bun.file(
            join(import.meta.dir, "../../public", path.slice(1)),
          );
          if (await file.exists()) return new Response(file);
        }
        return new Response(
          '<head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/SharedViewCreation.browser.css"></head><body><script type="module" src="/SharedViewCreation.browser.js"></script></body>',
          { headers: { "Content-Type": "text/html" } },
        );
      },
    });
    let browser: ReturnType<typeof Bun.spawn> | undefined;
    try {
      const build = await Bun.build({
        entrypoints: [join(import.meta.dir, "SharedViewCreation.browser.tsx")],
        outdir: dir,
        target: "browser",
        plugins: [
          {
            name: "raw-svg",
            setup(builder) {
              builder.onResolve({ filter: /\.svg\?raw$/ }, (args) => ({
                path: Bun.resolveSync(
                  args.path.slice(0, -4),
                  dirname(args.importer),
                ),
                namespace: "raw-svg",
              }));
              builder.onLoad(
                { filter: /.*/, namespace: "raw-svg" },
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
      for (const output of build.outputs)
        assets.set(`/${basename(output.path)}`, output);
      browser = Bun.spawn(
        [
          chrome!,
          "--headless=new",
          "--remote-debugging-port=0",
          "--window-size=1440,1000",
          "--enable-webgl",
          "--use-angle=swiftshader",
          "--enable-unsafe-swiftshader",
          "--disable-dev-shm-usage",
          "--disable-background-networking",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${join(dir, "profile")}`,
          server.url.href,
        ],
        { stdout: "ignore", stderr: Bun.file(join(dir, "browser.log")) },
      );
      const observed = await Promise.race([
        result.promise,
        browser.exited.then((code) => {
          throw new Error(`Browser exited ${code}`);
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Shared creation browser timed out")),
            120_000,
          );
        }),
      ]);
      if (observed.length) console.info("Shared creation failures", observed);
      expect(observed).toEqual([]);
    } finally {
      if (timeout) clearTimeout(timeout);
      socket?.close();
      browser?.kill();
      if (browser) await browser.exited;
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  150_000,
);
