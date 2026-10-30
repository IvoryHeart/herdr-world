import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  waitForBrowserFixture,
  waitForChromePort,
} from "../browserChrome";
import { InputDriver, denseSnapshot } from "./browserAcceptanceFixture";
import { startIndependentInput } from "./independentInputSchedule";
import { recordLatency } from "./testing/latencyTrend";
import { concurrentWorkViolations } from "./testing/workCeilings";

const chrome =
  Bun.env.CHROME_BIN || Bun.which("google-chrome") || Bun.which("chromium");

test.skipIf(!chrome).each([1440, 390])(
  "two mounted runtimes retain terminals and Files across focus and host retirement at %i pixels",
  async (width) => {
    const dir = await mkdtemp(join(tmpdir(), "world-concurrent-contexts-"));
    const assets = new Map<string, Blob>();
    const payload = await denseSnapshot();
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
        terminalWorkByPhase: Record<string, Record<string, number>>;
        boardObserverWorkByPhase: Record<string, Record<string, number>>;
        boardRenderByPhase: Record<
          string,
          { commits: number; totalMs: number; maxMs: number }
        >;
        worldBuildSliceCount: number;
        worldBuildUnits: number;
        worldBuildMaxSliceNodes: number;
        worldWorkByPhase: Record<string, Record<string, number>>;
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
    const pageRequested = Promise.withResolvers<void>();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/") pageRequested.resolve();
        if (path === "/dense-snapshot" && server.upgrade(request)) return;
        if (path === "/input-ready") {
          const phase = new URL(request.url).searchParams.get("phase")!;
          if (!driver) {
            // The page's readiness request proves Chrome has started. Chrome
            // chose its own DevTools port (no reserved number another server
            // could be handed) and wrote it to the profile.
            const debuggingPort = await waitForChromePort(
              browser!,
              join(dir, "profile"),
              join(dir, "browser.log"),
            );
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
          const pending: Promise<void>[] = [];
          const send = (input: {
            sequence: number;
            dueAt: number;
            sentAt: number;
          }) => {
            sentInputs.push({ phase, ...input });
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
          const stop = startIndependentInput(send);
          inputRuns.set(phase, {
            pending,
            stop,
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
          "--remote-debugging-port=0",
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
      const observed = await waitForBrowserFixture(
        pageRequested.promise,
        result.promise,
        browser.exited.then((code) => {
          throw new Error(`Browser exited ${code}`);
        }),
        "Concurrent context browser acceptance",
        45_000,
      );
      const refreshSent = sentInputs.filter(
        (input) => input.phase === "refresh",
      );
      const refreshReceipts = observed.stressReceipts.filter(
        (receipt) => receipt.phase === "refresh",
      );
      console.info(
        `Refresh work at ${width}px: ${JSON.stringify({
          maxInputMs: Math.max(
            ...refreshReceipts.map(
              (receipt, index) =>
                receipt.receivedAt - refreshSent[index]!.dueAt,
            ),
          ),
          terminal: observed.measurements.terminalWorkByPhase.refresh ?? {},
          cardObservers:
            observed.measurements.boardObserverWorkByPhase.refresh ?? {},
          boardRender: observed.measurements.boardRenderByPhase.refresh,
        })}`,
      );
      expect(observed.failures).toEqual([]);
      expect(observed.measurements.outputFrames).toBe(1536);
      expect(observed.measurements.snapshotBytes).toBeGreaterThan(20_000_000);
      // Work ceilings, not timings: see testing/workCeilings.ts.
      expect(concurrentWorkViolations(observed.measurements, width)).toEqual(
        [],
      );
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
      const worstDelay = inputDelays[inputDelays.length - 1]!;
      const senderLateness = Math.max(
        ...sentInputs.map((input) => input.sentAt - input.dueAt),
      );
      const sentAtMax = Math.max(
        ...observed.stressReceipts.map(
          (receipt, index) => receipt.receivedAt - sentInputs[index]!.sentAt,
        ),
      );
      console.info(
        `Budget check at ${width}px: worstDelay=${worstDelay}ms senderLateness=${senderLateness}ms sentAtMax=${sentAtMax}ms`,
      );
      // Input delays depend on the runner: the latency trend reports them.
      recordLatency("ConcurrentContexts", `${width}px`, {
        worstInputMs: worstDelay,
        p95InputMs: inputDelays[Math.ceil(inputDelays.length * 0.95) - 1]!,
        healthyInputMs: observed.measurements.healthyInputMs,
        snapshotTransportMs: observed.measurements.snapshotTransportMs,
        projectionMs: observed.measurements.projectionMs,
        renderMs: observed.measurements.renderMs,
        longestTaskMs: observed.measurements.longestTaskMs,
      });
      console.info(
        `Synthetic mounted terminals at ${width}px: ${JSON.stringify({ ...observed.measurements, inputDuringDenseMaxMs: inputDelays[inputDelays.length - 1], inputDuringDenseP95Ms: inputDelays[Math.ceil(inputDelays.length * 0.95) - 1], inputSenderMaxLatenessMs: Math.max(...sentInputs.map((input) => input.sentAt - input.dueAt)) })}`,
      );
    } finally {
      for (const run of inputRuns.values()) run.stop();
      driver?.close();
      browser?.kill();
      if (browser) await browser.exited;
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  60_000 + BROWSER_STARTUP_TIMEOUT_MS,
);
