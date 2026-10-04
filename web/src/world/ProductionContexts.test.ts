import { sendWorldSnapshotReply } from "../../../server/src/bridge/world-snapshot-reply";
import { WorldSnapshotAdmission } from "../../../server/src/bridge/world-snapshot-admission";
import { serveStatic } from "../../../server/src/http/static-files";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  WS_PER_MESSAGE_DEFLATE,
  sendWebSocketMessage,
  flushCoalescedMessages,
} from "../../../server/src/bridge/websocket-send";
import { createDenseSnapshotFixture } from "./browserAcceptanceFixture";

const chrome =
  Bun.env.CHROME_BIN || Bun.which("google-chrome") || Bun.which("chromium");

test.skipIf(!chrome).each(
  [
    { view: "uncertain", entry: "typing" },
    { view: "uncertain", entry: "fallback" },
    { view: "uncertain", entry: "popup" },
    { view: "tree", entry: "" },
    { view: "graph", entry: "" },
    { view: "office", entry: "" },
    { view: "office", entry: "animated" },
  ].flatMap((item) => [1440, 390].map((width) => ({ ...item, width }))),
)(
  "production transport and mounted acceptance: %j",
  async ({ view, entry, width }) => {
    const dir = await mkdtemp(join(tmpdir(), "world-production-contexts-"));
    const fixture =
      view === "uncertain"
        ? null
        : createDenseSnapshotFixture({
            workingInitially: entry === "animated",
          });
    const initialSnapshot = fixture ? await fixture.service.snapshot() : null;
    const payload = initialSnapshot ? JSON.stringify(initialSnapshot) : "";
    const largestHostBytes = initialSnapshot
      ? Math.max(
          ...initialSnapshot.connections.map((connection) =>
            Buffer.byteLength(JSON.stringify(connection), "utf8"),
          ),
        )
      : 0;
    const headerBytes = initialSnapshot
      ? Buffer.byteLength(
          JSON.stringify({
            revision: initialSnapshot.revision,
            observed_at: initialSnapshot.observed_at,
          }),
          "utf8",
        )
      : 0;
    let stalledResponseVerified = false;
    const admission = new WorldSnapshotAdmission();
    const diagnostic = Boolean(Bun.env.WORLD_TRACE_PREFIX);
    const serviceTasks: { stage: string; beginAt: number; endAt: number }[] =
      [];
    const serviceInputs: {
      id: string;
      receivedAt: number;
      repliedAt: number;
    }[] = [];
    const serviceSends: {
      id: string;
      sendAt: number;
      completedAt: number;
      bufferedBefore: number;
      bufferedAfter: number;
      result: number;
      bytes: number;
    }[] = [];
    const loopDelays: { dueAt: number; ranAt: number }[] = [];
    let nextLoopAt = Date.now() + 20;
    const loopMonitor = diagnostic
      ? setInterval(() => {
          const ranAt = Date.now();
          if (ranAt - nextLoopAt > 10)
            loopDelays.push({ dueAt: nextLoopAt, ranAt });
          nextLoopAt = ranAt + 20;
        }, 20)
      : undefined;
    const stringify = JSON.stringify;
    let serializationMs = 0;
    JSON.stringify = function (value, replacer: any, space?: string | number) {
      const began = performance.now();
      const beginAt = diagnostic ? Date.now() : 0;
      const text = stringify(value, replacer, space);
      if (diagnostic && performance.now() - began > 15)
        serviceTasks.push({ stage: "serialize", beginAt, endAt: Date.now() });
      if (value?.connections?.length === 64)
        serializationMs = Math.max(serializationMs, performance.now() - began);
      return text;
    } as typeof JSON.stringify;
    const reserve = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(),
    });
    const debuggingPort = reserve.port;
    reserve.stop(true);
    const calls: {
      id: string;
      host: string;
      generation: number;
      method: string;
      data?: string;
      receivedAt: number;
    }[] = [];
    const sent: { phase: string; dueAt: number; sentAt: number }[] = [];
    const dispatches: {
      phase: string;
      sequence: number;
      cdpSentAt: number;
      cdpCompleteAt: number;
    }[] = [];
    const producer = new Worker(
      new URL("./browserInput.worker.ts", import.meta.url).href,
    );
    let commandId = 0;
    const commands = new Map<
      number,
      ReturnType<typeof Promise.withResolvers<any>>
    >();
    producer.onmessage = ({ data }) => {
      if (data.dispatch) {
        dispatches.push(data.dispatch);
        return;
      }
      if (data.input) {
        sent.push(data.input);
        return;
      }
      const command = commands.get(data.id);
      if (!command) return;
      commands.delete(data.id);
      if (data.error) command.reject(Error(data.error));
      else command.resolve(data.result);
    };
    const command = (data: object) => {
      const id = ++commandId;
      const response = Promise.withResolvers<any>();
      commands.set(id, response);
      producer.postMessage({ id, ...data });
      return response.promise;
    };
    let dropNext = false;
    let revision = 0;
    let noise: ReturnType<typeof setInterval> | undefined;
    const result = Promise.withResolvers<{
      failures: string[];
      acknowledgements: {
        id: string;
        phase: string;
        receivedAt: number;
        host: string;
      }[];
      nativeInputs: {
        phase: string;
        sequence: number;
        nativeAt: number;
        target: string;
      }[];
      socketInputs: { id: string; phase: string; sentAt: number }[];
      socketReplies: { id: string; receivedAt: number }[];
      cloneAdmissions: {
        worker: number;
        index: number;
        host: string;
        phase: string | null;
        beganAt: number;
        completedAt: number;
        durationMs: number;
      }[];
      bridgeReplies: { id: string; beganAt: number; completedAt: number }[];
      phases: Record<string, number>;
      paints: number;
      notices: number;
      receivedFrames: number;
      presentedFrames: number;
    }>();
    const send = (
      ws: any,
      text: string,
      coalesceKey?: string,
      context = "synthetic acceptance",
      inputId?: string,
    ) =>
      sendWebSocketMessage(
        diagnostic && inputId
          ? {
              close: (code, reason) => ws.close(code, reason),
              getBufferedAmount: () => ws.getBufferedAmount(),
              send: (payload, compress) => {
                const sendAt = Date.now();
                const bufferedBefore = ws.getBufferedAmount();
                const result = ws.send(payload, compress);
                serviceSends.push({
                  id: inputId,
                  sendAt,
                  completedAt: Date.now(),
                  bufferedBefore,
                  bufferedAfter: ws.getBufferedAmount(),
                  result,
                  bytes: Buffer.byteLength(payload),
                });
                return result;
              },
            }
          : ws,
        text,
        {
          cleanup: () => {},
          coalesceKey,
          context,
        },
      );
    const frame = (ws: any, host: string, terminalId = "shared") =>
      send(
        ws,
        JSON.stringify({
          connection_id: host,
          connection_generation: 7,
          terminal: {
            terminal_id: terminalId,
            width: 80,
            height: 24,
            full: true,
            mouse_reporting: false,
            bytes: btoa("\x1b[H\x1b[2J" + "synthetic output\r\n".repeat(24)),
          },
        }),
        host + ":" + terminalId,
        "terminal-frame",
      );
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req, server) {
        const url = new URL(req.url);
        if (url.pathname === "/ws" && server.upgrade(req)) return;
        if (url.pathname === "/drop-next") {
          dropNext = true;
          return new Response("armed");
        }
        if (url.pathname === "/input-ready") {
          const phase = url.searchParams.get("phase")!;
          const pages = (await (
            await fetch("http://127.0.0.1:" + debuggingPort + "/json/list")
          ).json()) as { type: string; webSocketDebuggerUrl: string }[];
          await command({
            action: "start",
            profile: Bun.env.WORLD_PROFILE === "1",
            slowdown: Number(Bun.env.WORLD_CPU_RATE ?? 1),
            tracePath: Bun.env.WORLD_TRACE_PREFIX
              ? `${Bun.env.WORLD_TRACE_PREFIX}-${view}${entry ? `-${entry}` : ""}-${width}-${phase}.json`
              : undefined,
            phase,
            url: pages.find((page) => page.type === "page")!
              .webSocketDebuggerUrl,
          });
          return new Response("ready");
        }
        if (url.pathname === "/input-complete") {
          const observed = await command({
            action: "stop",
            phase: url.searchParams.get("phase")!,
            profile: Bun.env.WORLD_PROFILE === "1",
            tracePath: Bun.env.WORLD_TRACE_PREFIX
              ? `${Bun.env.WORLD_TRACE_PREFIX}-${view}${entry ? `-${entry}` : ""}-${width}-${url.searchParams.get("phase")}.json`
              : undefined,
          });
          if (observed.hotspots)
            console.log(
              "Production task profile",
              view,
              width,
              url.searchParams.get("phase"),
              JSON.stringify(observed.hotspots),
            );
          return Response.json(observed);
        }
        if (url.pathname === "/result") {
          result.resolve(await req.json());
          return new Response("ok");
        }
        if (/^\/world\/characters\/\d+-D-1\.png$/.test(url.pathname))
          return new Response(
            Bun.file(
              join(import.meta.dir, "../../public", url.pathname.slice(1)),
            ),
          );
        // Use the production static responder and its actual security headers.
        return serveStatic(req, dir);
      },
      websocket: {
        perMessageDeflate: WS_PER_MESSAGE_DEFLATE,
        open(ws) {
          send(
            ws,
            JSON.stringify({
              hello: true,
              bridge_protocol_version: 2,
              default_connection_id: "alpha",
              capabilities: {
                connection_id: true,
                connection_scoped_http: true,
                connection_runtime_generation: true,
                world_snapshot_chunks: true,
                world_snapshot_chunk_admission: true,
              },
            }),
          );
          if (view !== "uncertain")
            noise = setInterval(() => {
              for (let index = 0; index < 8; index++) frame(ws, "alpha");
            }, 25);
        },
        async message(ws, raw) {
          const receivedAt = diagnostic ? Date.now() : 0;
          const request = JSON.parse(String(raw));
          if (admission.acknowledge(ws, request)) return;
          request.connection_id ??= request.params?.connection_id;
          request.connection_generation ??=
            request.params?.connection_generation;
          const scoped = request.connection_id !== undefined;
          const reply = (value: unknown) =>
            send(
              ws,
              JSON.stringify({
                id: request.id,
                result: value,
                ...(scoped
                  ? {
                      connection_id: request.connection_id,
                      connection_generation: request.connection_generation,
                    }
                  : {}),
              }),
              undefined,
              "synthetic acceptance",
              request.method === "terminal.input" ? request.id : undefined,
            );
          if (request.method === "world.snapshot") {
            const task = { stage: "snapshot", beginAt: Date.now(), endAt: 0 };
            if (diagnostic) serviceTasks.push(task);
            const refresh = ++revision === 2;
            if (refresh) fixture!.startStalledAttentionRefresh();
            const began = Date.now();
            const snapshotResult = await fixture!.service.snapshot(
              request.params,
            );
            task.endAt = Date.now();
            if (refresh)
              stalledResponseVerified =
                Date.now() - began >= 19900 &&
                fixture!.stalledIds.every((id) =>
                  snapshotResult.connections.some(
                    (connection) =>
                      connection.connection_id === id && connection.stale,
                  ),
                );
            const framing = { stage: "framing", beginAt: Date.now(), endAt: 0 };
            if (diagnostic) serviceTasks.push(framing);
            const transfer =
              request.accept_world_snapshot_chunks === true &&
              request.accept_world_snapshot_chunk_admission === true
                ? admission.open(ws, request.id)
                : undefined;
            try {
              await sendWorldSnapshotReply(
                request.id,
                snapshotResult,
                request.accept_world_snapshot_chunks === true,
                (text) => send(ws, text, undefined, "world-snapshot"),
                () => ws.readyState === 1,
                transfer?.wait,
              );
            } finally {
              transfer?.close();
            }
            framing.endAt = Date.now();
            return;
          }
          if (
            scoped &&
            (!["alpha", "beta"].includes(request.connection_id) ||
              request.connection_generation !== 7)
          ) {
            send(
              ws,
              JSON.stringify({
                id: request.id,
                error: { message: "Synthetic lease unavailable" },
                connection_id: request.connection_id,
                connection_generation: request.connection_generation,
              }),
            );
            return;
          }
          calls.push({
            id: request.id,
            host: request.connection_id,
            generation: request.connection_generation,
            method: request.method,
            data: request.params?.data ? atob(request.params.data) : undefined,
            receivedAt: Date.now(),
          });
          if (request.method === "terminal.input" && dropNext) {
            dropNext = false;
            ws.close(4000, "synthetic lost acknowledgement");
            return;
          }
          if (request.method === "terminal.attach") {
            reply({
              endpoint: {
                methods: ["pane.focus", "pane.scroll"],
                capabilities: [],
              },
            });
            frame(ws, request.connection_id, request.params.terminal_id);
            return;
          }
          if (request.method === "pane.layout") {
            reply({
              layout: {
                workspace_id: "shared",
                tab_id: "shared",
                zoomed: false,
                area: { x: 0, y: 0, width: 80, height: 24 },
                focused_pane_id: "shared",
                panes: [
                  {
                    pane_id: "shared",
                    focused: true,
                    rect: { x: 0, y: 0, width: 80, height: 24 },
                  },
                ],
                splits: [],
              },
            });
            return;
          }
          reply({});
          if (diagnostic && request.method === "terminal.input")
            serviceInputs.push({
              id: request.id,
              receivedAt,
              repliedAt: Date.now(),
            });
        },
        drain(ws) {
          flushCoalescedMessages(ws, {
            cleanup: () => {},
            context: "synthetic drain",
          });
        },
        close(ws) {
          admission.retire(ws);
          clearInterval(noise);
        },
      },
    });
    let browser: ReturnType<typeof Bun.spawn> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const build = await Bun.build({
        entrypoints: [join(import.meta.dir, "ProductionContexts.browser.tsx")],
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
                  contents:
                    "export default " +
                    JSON.stringify(await Bun.file(args.path).text()),
                  loader: "js",
                }),
              );
            },
          },
        ],
      });
      if (!build.success) throw Error(build.logs.join("\n"));
      for (const output of build.outputs)
        if (!(await Bun.file(output.path).exists()))
          await Bun.write(output.path, output);
      await Bun.write(
        join(dir, "index.html"),
        '<link rel="stylesheet" href="/ProductionContexts.browser.css"><script type="module" src="/ProductionContexts.browser.js"></script>',
      );
      browser = Bun.spawn(
        [
          chrome!,
          "--headless=new",
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--use-angle=swiftshader",
          "--enable-unsafe-swiftshader",
          "--disable-background-timer-throttling",
          "--disable-renderer-backgrounding",
          "--disable-backgrounding-occluded-windows",
          "--remote-debugging-port=" + debuggingPort,
          "--user-data-dir=" + dir + "/profile",
          "--window-size=" + width + ",1100",
          server.url +
            "?view=" +
            view +
            "&entry=" +
            entry +
            (Bun.env.WORLD_TRACE_PREFIX ? "&trace=1" : ""),
        ],
        { stdout: "ignore", stderr: "ignore" },
      );
      const observed = await Promise.race([
        result.promise,
        new Promise<never>((_, reject) => {
          // Bound browser startup and both observation/render phases, including
          // the deliberate 20-second stall. Input latency has separate budgets.
          deadline = setTimeout(
            () => reject(Error("Production context acceptance deadline")),
            90000,
          );
        }),
      ]);
      if (view === "uncertain")
        expect(
          calls.some(
            (call) => call.method === "terminal.input" && call.host === "alpha",
          ),
        ).toBe(true);
      if (observed.failures.length)
        console.info(
          "Synthetic transport diagnostic",
          JSON.stringify({
            failures: observed.failures,
            inputs: calls
              .filter((call) => call.method === "terminal.input")
              .slice(0, 3),
            last: calls.slice(-3),
            sent: sent.length,
            acknowledged: observed.acknowledgements.length,
            phases: observed.phases,
          }),
        );
      expect(observed.failures).toEqual([]);
      if (view === "uncertain") {
        expect(
          calls.filter(
            (call) => call.method === "terminal.input" && call.host === "alpha",
          ),
        ).toHaveLength(1);
        expect(
          calls.filter(
            (call) => call.method === "terminal.input" && call.host === "beta",
          ),
        ).toHaveLength(1);
        expect(observed.notices).toBe(1);
      } else {
        const inputs = calls.filter((call) => call.method === "terminal.input");
        expect(inputs).toHaveLength(sent.length);
        expect(
          inputs.every(
            (call) =>
              call.host === "beta" &&
              call.generation === 7 &&
              call.data === "z",
          ),
        ).toBe(true);
        expect(observed.acknowledgements).toHaveLength(sent.length);
        const intents = new Map(
          inputs.map((input, index) => [input.id, sent[index]!]),
        );
        expect(
          new Set(observed.acknowledgements.map((ack) => ack.id)).size,
        ).toBe(sent.length);
        expect(
          observed.acknowledgements.every((ack) => intents.has(ack.id)),
        ).toBe(true);
        const delays = observed.acknowledgements
          .map((ack) => ack.receivedAt - intents.get(ack.id)!.dueAt)
          .sort((a, b) => a - b);
        const sentDelays = observed.acknowledgements
          .map((ack) => ack.receivedAt - intents.get(ack.id)!.sentAt)
          .sort((a, b) => a - b);
        const dispatch = inputs.map(
          (call, index) => call.receivedAt - sent[index]!.dueAt,
        );
        if (Bun.env.WORLD_TRACE_PREFIX)
          await Bun.write(
            `${Bun.env.WORLD_TRACE_PREFIX}-${view}${entry ? `-${entry}` : ""}-${width}-inputs.json`,
            JSON.stringify({
              sent,
              inputs,
              acknowledgements: observed.acknowledgements,
              nativeInputs: observed.nativeInputs,
              socketInputs: observed.socketInputs,
              dispatches,
              serviceTasks,
              serviceInputs,
              serviceSends,
              socketReplies: observed.socketReplies,
              cloneAdmissions: observed.cloneAdmissions,
              bridgeReplies: observed.bridgeReplies,
              loopDelays,
              phases: observed.phases,
            }),
          );
        console.info(
          "Production dense " +
            view +
            (entry ? " " + entry : "") +
            " " +
            width +
            "px: " +
            JSON.stringify({
              bytes: new TextEncoder().encode(payload).length,
              largestHostBytes,
              headerBytes,
              serializationMs,
              keys: sent.length,
              maxDispatchMs: Math.max(...dispatch),
              maxAckMs: Math.max(...delays),
              p95AckMs: delays[Math.ceil(delays.length * 0.95) - 1],
              maxSentToAckMs: Math.max(...sentDelays),
              p95SentToAckMs:
                sentDelays[Math.ceil(sentDelays.length * 0.95) - 1],
              senderLatenessMs: Math.max(
                ...sent.map((input) => input.sentAt - input.dueAt),
              ),
              phases: observed.phases,
              paints: observed.paints,
              receivedFrames: observed.receivedFrames,
              presentedFrames: observed.presentedFrames,
            }),
        );
        // Fixed synthetic Chrome workload budget, not a runtime/network SLA.
        // Independent review accepts bounded first-paint tails for this fixed
        // 64-profile workload; retain both percentile and worst-case limits.
        expect(delays[Math.ceil(delays.length * 0.95) - 1]).toBeLessThan(200);
        expect(Math.max(...delays)).toBeLessThan(500);
        expect(stalledResponseVerified).toBe(true);
        expect(observed.receivedFrames).toBeGreaterThan(500);
        expect(observed.presentedFrames).toBeGreaterThan(10);
        expect(observed.presentedFrames).toBeLessThan(
          observed.receivedFrames / 2,
        );
        expect(observed.paints).toBeGreaterThan(
          view === "tree" || (view === "graph" && width === 390) ? -1 : 2,
        );
      }
    } finally {
      clearInterval(loopMonitor);
      JSON.stringify = stringify;
      fixture?.release();
      producer.terminate();
      clearInterval(noise);
      clearTimeout(deadline);
      browser?.kill();
      if (browser) await browser.exited;
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  // Also allow fixture/build setup and cleanup outside the browser watchdog.
  100000,
);
