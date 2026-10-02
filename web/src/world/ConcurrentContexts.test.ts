import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { InputDriver, denseSnapshot } from "./browserAcceptanceFixture";

const chrome =
  Bun.env.CHROME_BIN || Bun.which("google-chrome") || Bun.which("chromium");

test.skipIf(!chrome).each([1440, 390])(
  "two mounted runtimes retain terminals and Files across focus and host retirement at %i pixels",
  async (width) => {
    const dir = await mkdtemp(join(tmpdir(), "world-concurrent-contexts-"));
    const assets = new Map<string, Blob>();
    const payload = await denseSnapshot();
    const portReservation = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("reserved"),
    });
    const debuggingPort = portReservation.port;
    portReservation.stop(true);
    let driver: InputDriver | undefined;
    const inputRuns = new Map<
      string,
      { stop(): void; pending: Promise<void>[] }
    >();
    const sentInputs: { phase: string; sentAt: number; dueAt: number }[] = [];
    const result = Promise.withResolvers<{
      failures: string[];
      measurements: {
        outputFrames: number;
        outputBytes: number;
        healthyInputMs: number;
        snapshotBytes: number;
        snapshotTransportMs: number;
        projectionMs: number;
        renderMs: number;
        longestTaskMs: number;
      };
      stressReceipts: {
        phase: string;
        host: string;
        generation: number;
        receivedAt: number;
        data: string;
        trusted: boolean;
      }[];
    }>();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/dense-snapshot" && server.upgrade(request)) return;
        if (path === "/input-ready") {
          const phase = new URL(request.url).searchParams.get("phase")!;
          if (!driver) {
            // The page's readiness request proves Chrome has started; no status polling.
            const targets = (await (
              await fetch(`http://127.0.0.1:${debuggingPort}/json/list`)
            ).json()) as { type: string; webSocketDebuggerUrl: string }[];
            const socket = new WebSocket(
              targets.find((target) => target.type === "page")!
                .webSocketDebuggerUrl,
            );
            await new Promise<void>((resolve, reject) => {
              socket.onopen = () => resolve();
              socket.onerror = () =>
                reject(new Error("CDP input connection failed"));
            });
            driver = new InputDriver(socket);
          }
          await driver.call("Runtime.evaluate", {
            expression: `document.querySelector('[data-host="beta"] .xterm-helper-textarea').focus()`,
          });
          const began = Date.now();
          const pending: Promise<void>[] = [];
          let index = 0;
          const send = () => {
            const dueAt = began + 5 + index++ * 75;
            sentInputs.push({ phase, dueAt, sentAt: Date.now() });
            pending.push(
              (async () => {
                await driver!.call("Input.dispatchKeyEvent", {
                  type: "keyDown",
                  key: "z",
                  code: "KeyZ",
                  text: "z",
                  windowsVirtualKeyCode: 90,
                });
                await driver!.call("Input.dispatchKeyEvent", {
                  type: "keyUp",
                  key: "z",
                  code: "KeyZ",
                  windowsVirtualKeyCode: 90,
                });
              })(),
            );
          };
          let interval: ReturnType<typeof setInterval> | undefined;
          const first = setTimeout(() => {
            send();
            interval = setInterval(send, 75);
          }, 5);
          inputRuns.set(phase, {
            pending,
            stop() {
              clearTimeout(first);
              clearInterval(interval);
            },
          });
          return new Response("ready");
        }
        if (path === "/input-complete") {
          const run = inputRuns.get(
            new URL(request.url).searchParams.get("phase")!,
          )!;
          run.stop();
          await Promise.all(run.pending);
          return Response.json({ count: run.pending.length });
        }
        if (path === "/result") {
          result.resolve(await request.json());
          return new Response("ok");
        }
        const asset = assets.get(path);
        if (asset) return new Response(asset);
        return new Response(
          '<head><link rel="stylesheet" href="/ConcurrentContexts.browser.css"></head><body><script type="module" src="/ConcurrentContexts.browser.js"></script></body>',
          { headers: { "Content-Type": "text/html" } },
        );
      },
      websocket: {
        open(socket) {
          socket.send(payload);
        },
        message(socket) {
          socket.close();
        },
      },
    });
    let browser: ReturnType<typeof Bun.spawn> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const build = await Bun.build({
        entrypoints: [join(import.meta.dir, "ConcurrentContexts.browser.tsx")],
        outdir: dir,
        target: "browser",
        plugins: [
          {
            name: "vite-raw-svg",
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
          `--remote-debugging-port=${debuggingPort}`,
          `--window-size=${width},1000`,
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
            () =>
              reject(
                new Error("Concurrent context browser acceptance timed out"),
              ),
            45_000,
          );
        }),
      ]);
      expect(observed.failures).toEqual([]);
      expect(observed.measurements.outputFrames).toBe(1536);
      expect(observed.measurements.snapshotBytes).toBeGreaterThan(20_000_000);
      expect(observed.measurements.snapshotTransportMs).toBeLessThan(20_000);
      expect(observed.measurements.healthyInputMs).toBeLessThan(1000);
      expect(observed.stressReceipts).toHaveLength(sentInputs.length);
      const inputDelays: number[] = [];
      for (const phase of ["projection", "render", "refresh", "noisy-output"]) {
        const receipts = observed.stressReceipts.filter(
          (receipt) => receipt.phase === phase,
        );
        const sent = sentInputs.filter((input) => input.phase === phase);
        expect(receipts).toHaveLength(sent.length);
        expect(receipts.length).toBeGreaterThan(0);
        expect(
          receipts.every(
            (receipt) =>
              receipt.host === "beta" &&
              receipt.generation === 7 &&
              receipt.data === "z" &&
              receipt.trusted,
          ),
        ).toBe(true);
        receipts.forEach((receipt, index) =>
          inputDelays.push(receipt.receivedAt - sent[index]!.dueAt),
        );
      }
      inputDelays.sort((left, right) => left - right);
      console.info(
        `Dense input by phase at ${width}px: ${JSON.stringify(Object.fromEntries(["projection", "render", "refresh", "noisy-output"].map((phase) => [phase, observed.stressReceipts.filter((receipt) => receipt.phase === phase).map((receipt, index) => receipt.receivedAt - sentInputs.filter((input) => input.phase === phase)[index]!.dueAt)])))}; stages: ${JSON.stringify(observed.measurements)}`,
      );
      // Engineering acceptance budget for this fixed synthetic workload, not a spec SLA.
      expect(inputDelays[inputDelays.length - 1]).toBeLessThan(200);
      console.info(
        `Synthetic mounted terminals at ${width}px: ${JSON.stringify({ ...observed.measurements, inputDuringDenseMaxMs: inputDelays[inputDelays.length - 1], inputDuringDenseP95Ms: inputDelays[Math.ceil(inputDelays.length * 0.95) - 1], inputSenderMaxLatenessMs: Math.max(...sentInputs.map((input) => input.sentAt - input.dueAt)) })}`,
      );
    } finally {
      for (const run of inputRuns.values()) run.stop();
      clearTimeout(timeout);
      driver?.close();
      browser?.kill();
      if (browser) await browser.exited;
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  60_000,
);
