import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import { stopChrome, waitForBrowserFixture } from "./browserChrome";
import { SWIFTSHADER_FLAGS } from "./world/testing/chromeRendering";

const chrome =
  Bun.env.CHROME_BIN || Bun.which("google-chrome") || Bun.which("chromium");
const root = resolve(import.meta.dir, "../..");
type Result = { mounted: boolean; entry: string | null; errors: string[] };

test.skipIf(!chrome)(
  "the real Vite application entry mounts without startup exceptions",
  async () => {
    const artifacts = join(root, ".agents/delivery");
    await mkdir(artifacts, { recursive: true });
    const directory = await mkdtemp(join(artifacts, "app-startup-"));
    const result = Promise.withResolvers<Result>();
    const pageRequested = Promise.withResolvers<void>();
    // Isolate development proxy traffic from any running World/Herdr instance.
    const backend = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({}),
    });
    const target = backend.url.origin;
    let child: ReturnType<typeof Bun.spawn> | undefined;
    let vite: Awaited<ReturnType<typeof createServer>> | undefined;
    try {
      vite = await createServer({
        root: join(root, "web"),
        configFile: join(root, "web/vite.config.ts"),
        cacheDir: join(directory, "vite-cache"),
        logLevel: "silent",
        server: {
          host: "127.0.0.1",
          port: 0,
          strictPort: true,
          proxy: {
            "/ws": { target, ws: true },
            "/api": { target },
            "/manifest.json": { target },
            "/login": { target },
          },
        },
        plugins: [
          {
            name: "application-startup-observer",
            configureServer(server) {
              server.middlewares.use((request, response, next) => {
                if (request.url === "/") pageRequested.resolve();
                if (
                  request.url !== "/__startup_result" ||
                  request.method !== "POST"
                )
                  return next();
                let body = "";
                request.on("data", (chunk) => {
                  body += String(chunk);
                });
                request.on("end", () => {
                  result.resolve(JSON.parse(body));
                  response.end("ok");
                });
              });
            },
            transformIndexHtml: {
              order: "pre",
              handler: () => [
                {
                  tag: "script",
                  injectTo: "head-prepend",
                  children: `
          (() => {
            const errors=[]; let sent=false;
            const report=mounted=>{
              if(sent)return;sent=true;
              fetch('/__startup_result',{method:'POST',body:JSON.stringify({mounted,
                entry:document.querySelector('script[src="/src/main.tsx"]')?.getAttribute('src')??null,errors})});
            };
            window.addEventListener('error',event=>{errors.push(event.message);report(false);});
            window.addEventListener('unhandledrejection',event=>{errors.push(String(event.reason));report(false);});
            const inspect=()=>{
              const boundary=document.querySelector('#root > pre');
              if(boundary){errors.push(boundary.textContent);report(false);return;}
              if(document.querySelector('#root .world-foundation-shell')){setTimeout(()=>report(true),250);return;}
              if(!sent)requestAnimationFrame(inspect);
            };
            document.addEventListener('DOMContentLoaded',inspect);
            setTimeout(()=>{errors.push('Application root did not mount');report(false);},90000);
          })();`,
                },
              ],
            },
          },
        ],
      });
      await vite.listen();
      const address = vite.resolvedUrls?.local[0];
      if (!address) throw new Error("Missing isolated dev URL");
      expect([8787, 8788, 8789]).not.toContain(Number(new URL(address).port));
      child = Bun.spawn(
        [
          chrome!,
          "--headless=new",
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-background-networking",
          "--disable-component-update",
          "--disable-sync",
          "--no-proxy-server",
          "--window-size=1440,900",
          `--user-data-dir=${join(directory, "profile")}`,
          ...SWIFTSHADER_FLAGS,
          address,
        ],
        { stdout: "ignore", stderr: "ignore" },
      );
      const observed = await waitForBrowserFixture(
        pageRequested.promise,
        result.promise,
        child.exited.then((code) => {
          throw new Error(`Browser exited ${code}`);
        }),
        "Real application startup",
        95000,
      );
      expect(observed.errors).toEqual([]);
      expect(observed).toMatchObject({ mounted: true, entry: "/src/main.tsx" });
    } finally {
      backend.stop(true);
      try {
        await stopChrome(child);
      } finally {
        try {
          await vite?.close();
        } finally {
          await rm(directory, {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 100,
          });
        }
      }
    }
  },
  120000,
);
