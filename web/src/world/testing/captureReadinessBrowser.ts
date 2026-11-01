import { expect, test } from "bun:test";
import { mkdtemp, rm, readFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir, loadavg } from "node:os";
import { join, basename } from "node:path";
import {
  stopChrome,
  waitForChromePort,
  withBrowserDeadline,
} from "../../browserChrome";
import { chromeRenderingFlags } from "./chromeRendering";
import { connectCapture } from "./connectCapture";
import { captureScene, resizeCapture } from "./captureScene";
import { captureResumeViewports } from "./resumeVisualCapture";

export function registerCaptureReadinessTests() {
  const chrome =
    Bun.env.CHROME_BIN || Bun.which("google-chrome") || Bun.which("chromium");
  test.skipIf(!chrome)(
    "capture waits for controlled slow assets/fonts, fences resize/view changes and rejects missing content",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "capture-readiness-"));
      const assets = new Map<string, Blob>();
      const mounted = Promise.withResolvers<void>();
      let waiting = Promise.withResolvers<void>();
      const image = Promise.withResolvers<void>(),
        font = Promise.withResolvers<void>();
      const requestedImage = Promise.withResolvers<void>(),
        requestedFont = Promise.withResolvers<void>();
      const never = Promise.withResolvers<void>();
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const path = new URL(request.url).pathname;
          if (path === "/mounted") {
            mounted.resolve();
            return new Response(null, { status: 204 });
          }
          if (path === "/waiting") {
            waiting.resolve();
            return new Response(null, { status: 204 });
          }
          if (path === "/held-image" || path === "/never-image") {
            if (path === "/held-image") {
              requestedImage.resolve();
              await image.promise;
            } else await never.promise;
            return new Response(
              '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="blue"/></svg>',
              { headers: { "Content-Type": "image/svg+xml" } },
            );
          }
          if (path === "/held-font") {
            requestedFont.resolve();
            await font.promise;
            return new Response(
              Bun.file(
                join(import.meta.dir, "town-golden/fonts/sans-400.woff2"),
              ),
            );
          }
          if (path === "/herdr-world-logo.svg")
            return new Response(
              Bun.file(
                join(import.meta.dir, "../../../public/herdr-world-logo.svg"),
              ),
            );
          if (assets.has(path)) return new Response(assets.get(path));
          if (path === "/")
            return new Response(
              '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/CaptureReadiness.browser.css"><div id="root" style="position:fixed;inset:0;display:flex;flex-direction:column"></div><script type="module" src="/CaptureReadiness.browser.js"></script>',
              { headers: { "Content-Type": "text/html" } },
            );
          return new Response("Not found", { status: 404 });
        },
      });
      let child: ReturnType<typeof Bun.spawn> | undefined;
      let connection: Awaited<ReturnType<typeof connectCapture>> | undefined;
      try {
        const build = await Bun.build({
          entrypoints: [join(import.meta.dir, "CaptureReadiness.browser.tsx")],
          outdir: dir,
          target: "browser",
          plugins: [
            {
              name: "raw-svg",
              setup(builder) {
                builder.onResolve({ filter: /\?raw$/ }, (args) => ({
                  path: Bun.resolveSync(
                    args.path.slice(0, -4),
                    args.resolveDir,
                  ),
                  namespace: "raw",
                }));
                builder.onLoad(
                  { filter: /.*/, namespace: "raw" },
                  async (args) => ({
                    contents: await readFile(args.path, "utf8"),
                    loader: "text",
                  }),
                );
              },
            },
          ],
        });
        expect(build.success).toBe(true);
        for (const output of build.outputs)
          assets.set(`/${basename(output.path)}`, output);
        const log = join(dir, "chrome.log"),
          profile = join(dir, "profile");
        child = Bun.spawn(
          [
            chrome!,
            "--headless=new",
            "--remote-debugging-port=0",
            "--no-first-run",
            "--no-default-browser-check",
            `--user-data-dir=${profile}`,
            ...(await chromeRenderingFlags(chrome!)),
            server.url.href,
          ],
          { stdout: "ignore", stderr: Bun.file(log) },
        );
        const port = await waitForChromePort(child, profile, log);
        connection = await connectCapture(port);
        const command = connection.command;
        const evaluate = async (expression: string) => {
          const r = await command("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
          });
          if (r.exceptionDetails)
            throw new Error(r.exceptionDetails.exception?.description);
          return r.result.value;
        };
        await withBrowserDeadline(
          mounted.promise,
          "capture fixture mounted",
          30000,
        );
        await evaluate(
          `(()=>{const c=window.__HERDR_WORLD_CAPTURE__,wait=c.wait.bind(c);c.wait=(o)=>{const p=wait(o);void fetch('/waiting');return p;};})()`,
        );
        await resizeCapture(command, 1512, 982);
        await evaluate(
          "captureFixture.asset('held-image');captureFixture.font()",
        );
        await Promise.all([requestedImage.promise, requestedFont.promise]);
        let screenshots = 0;
        const tracked = async (
          method: string,
          params?: Record<string, unknown>,
        ) => {
          if (method === "Page.captureScreenshot") screenshots++;
          return command(method, params);
        };
        const slow = captureScene(tracked, {
          view: "town",
          width: 1512,
          height: 982,
          content: { selector: "canvas[data-office-canvas]" },
        });
        await withBrowserDeadline(waiting.promise, "capture wait begins");
        expect(screenshots).toBe(0);
        expect(
          await evaluate("document.documentElement.dataset.worldDrawn ?? null"),
        ).toBeNull();
        image.resolve();
        font.resolve();
        const current = await slow;
        expect(current.receipt.view).toBe("town");
        expect(current.sanity.foreground).toBeGreaterThan(0.02);
        const old = current.receipt;
        await resizeCapture(command, 1280, 1440);
        expect(
          await evaluate(
            `window.__HERDR_WORLD_CAPTURE__.matches(${JSON.stringify(old)})`,
          ),
        ).toBe(false);
        const resized = await captureScene(command, {
          view: "town",
          width: 1280,
          height: 1440,
        });
        expect(resized.receipt.revision).toBeGreaterThan(old.revision);
        // Request-driven captures: all five sizes, the same synthetic topology.
        if (Bun.env.WORLD_CAPTURE_EVIDENCE_DIR)
          await captureResumeViewports(
            port,
            Bun.env.WORLD_CAPTURE_EVIDENCE_DIR,
            "town",
            { content: { selector: "canvas[data-office-canvas]" } },
          );
        await evaluate("captureFixture.retainHiddenTown()");
        for (const view of ["board", "desk"] as const) {
          await evaluate(`captureFixture.mount(${JSON.stringify(view)})`);
          await resizeCapture(command, 1280, 1440);
          const size = { width: 1280, height: 1440 };
          const frame = await captureScene(command, {
            view: view as "board" | "desk",
            ...size,
          });
          expect(frame.receipt.view).toBe(view);
          let hidden = "";
          try {
            await captureScene(command, { view: "town", ...size });
          } catch (e) {
            hidden = String(e);
          }
          expect(hidden).toContain("found 0");
          expect(
            await evaluate(
              `window.__HERDR_WORLD_CAPTURE__.matches(${JSON.stringify(resized.receipt)})`,
            ),
          ).toBe(false);
          if (Bun.env.WORLD_CAPTURE_EVIDENCE_DIR)
            await captureResumeViewports(
              port,
              Bun.env.WORLD_CAPTURE_EVIDENCE_DIR,
              view,
              {
                content: {
                  selector:
                    view === "board" ? ".board-workspace" : ".desk-card",
                },
              },
            );
          await evaluate(`captureFixture.mount(${JSON.stringify(view)},true)`);
          await resizeCapture(command, 1280, 1440);
          const dimensions = { width: 1280, height: 1440 };
          expect(
            (
              await captureScene(command, {
                view: view as "board" | "desk",
                ...dimensions,
              })
            ).receipt.view,
          ).toBe(view);
          let missing = "";
          try {
            await captureScene(command, {
              view: view as "board" | "desk",
              ...dimensions,
              content: { selector: ".does-not-exist" },
            });
          } catch (e) {
            missing = String(e);
          }
          expect(missing).toContain("expected content missing");
        }
        // A uniform output with a nominal DOM element must still fail sanity.
        await evaluate(
          `(()=>{const s=document.createElement('style');s.id='blank-control';s.textContent='.desk>*{visibility:hidden}.desk{background:#fff!important}';document.head.append(s);const el=document.createElement('div');el.className='capture-expected';el.style.cssText='visibility:visible;position:absolute;width:2px;height:2px';document.querySelector('.desk').append(el);})()`,
        );
        const blankSize = await evaluate(
          "({width:innerWidth,height:innerHeight})",
        );
        let background = "";
        try {
          await captureScene(command, {
            view: "desk",
            ...blankSize,
            content: { selector: ".capture-expected" },
          });
        } catch (e) {
          background = String(e);
        }
        expect(background).toContain("predominantly background");
        await evaluate(
          "document.getElementById('blank-control').remove();captureFixture.mount('town')",
        );
        let changed = "";
        try {
          await captureScene(
            async (method, params) => {
              const reply = await command(method, params);
              if (method === "Page.captureScreenshot")
                await evaluate("captureFixture.mount('desk')");
              return reply;
            },
            { view: "town", ...blankSize },
          );
        } catch (e) {
          changed = String(e);
        }
        expect(changed).toContain("revision changed during screenshot");
        await evaluate(
          "captureFixture.mount('town');captureFixture.asset('never-image')",
        );
        const dimensions = await evaluate(
          "({width:innerWidth,height:innerHeight})",
        );
        let failed = "";
        try {
          await captureScene(command, {
            view: "town",
            ...dimensions,
            timeoutMs: 100,
          });
        } catch (e) {
          failed = String(e);
        }
        expect(failed).toContain("stage=assets");
        const failedDir = join(dir, "failed-capture");
        let neverArtifact = "";
        try {
          await captureResumeViewports(port, failedDir, "never", {
            timeoutMs: 100,
          });
        } catch (e) {
          neverArtifact = String(e);
        }
        expect(neverArtifact).toContain("stage=assets");
        expect(await readdir(failedDir)).toEqual([]);
        // Recover on the same mounted owner without releasing /never-image.
        await resizeCapture(command, dimensions.width, dimensions.height);
        const ownerBeforeRemoval = await evaluate(
          "document.querySelector('#root .town-shell').dataset.worldCaptureOwner",
        );
        waiting = Promise.withResolvers<void>();
        const recovering = captureScene(command, {
          view: "town",
          ...dimensions,
          content: { selector: "canvas[data-office-canvas]" },
        });
        await withBrowserDeadline(
          waiting.promise,
          "replacement capture waits on obsolete image",
        );
        await evaluate("captureFixture.removeAssets()");
        const replacement = await recovering;
        expect(String(replacement.receipt.owner)).toBe(ownerBeforeRemoval);
        expect(replacement.sanity.foreground).toBeGreaterThan(0.02);
        const nextCapture = await captureScene(command, {
          view: "town",
          ...dimensions,
          content: { selector: "canvas[data-office-canvas]" },
        });
        expect(nextCapture.receipt.owner).toBe(replacement.receipt.owner);
        if (Bun.env.WORLD_CAPTURE_EVIDENCE_DIR) {
          await mkdir(Bun.env.WORLD_CAPTURE_EVIDENCE_DIR, { recursive: true });
          await Bun.write(
            join(Bun.env.WORLD_CAPTURE_EVIDENCE_DIR, "controls.json"),
            JSON.stringify(
              {
                controlledDelay:
                  "image and font held until capture pending with no marker or screenshot",
                slow: current.receipt,
                resize: resized.receipt,
                neverReady: failed,
                replacementAfterNeverReady: replacement.receipt,
                obsoleteImageReleasedBeforeReplacement: false,
                loadAverage: loadavg(),
              },
              null,
              2,
            ),
          );
        }
      } finally {
        image.resolve();
        font.resolve();
        never.resolve();
        connection?.close();
        await stopChrome(child);
        server.stop(true);
        await rm(dir, { recursive: true, force: true });
      }
    },
    90000,
  );
}
