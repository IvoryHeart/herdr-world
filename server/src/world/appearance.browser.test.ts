import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { BoardStore } from "./board-store";
import { handleAppearanceRpc } from "../rpc/appearance";
import type { BridgeRpcContext } from "../rpc/context";
import {
  stopChrome,
  waitForChromePort,
  withBrowserDeadline,
  BROWSER_STARTUP_TIMEOUT_MS,
} from "../../../web/src/browserChrome";
const chrome =
  Bun.env.CHROME_BIN || Bun.which("google-chrome") || Bun.which("chromium");

test.skipIf(!chrome)(
  "shared appearance survives independent desktop and phone clients, native failure and per-pane reset",
  async () => {
    await mkdir(".agents/delivery", { recursive: true });
    const dir = await mkdtemp(
      join(process.cwd(), ".agents/delivery/appearance-browser-"),
    );
    const board = new BoardStore(join(dir, "board.json"));
    const events = new Set<ReadableStreamDefaultController<Uint8Array>>();
    const publish = (control: Record<string, unknown>) => {
      const event = new TextEncoder().encode(
        `data: ${JSON.stringify(control)}\n\n`,
      );
      for (const stream of events) stream.enqueue(event);
    };
    const results = [
      Promise.withResolvers<string[]>(),
      Promise.withResolvers<string[]>(),
    ];
    const adapterResult = Promise.withResolvers<string[]>();
    const adapterTools =
      Promise.withResolvers<
        (
          method: string,
          params?: Record<string, unknown>,
        ) => Promise<Record<string, unknown>>
      >();
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    let destination = false,
      moved = false;
    let label = "Analysis",
      failName = false;
    const assets = new Map<string, Blob>();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/events") {
          let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                stream = controller;
                events.add(controller);
              },
              cancel() {
                if (stream) events.delete(stream);
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } },
          );
        }
        if (url.pathname === "/native")
          return Response.json({ label, destination, moved });
        if (url.pathname === "/inspection") return Response.json(calls);
        if (url.pathname === "/adapter-mobile") {
          const cdp = await adapterTools.promise;
          await cdp("Emulation.setDeviceMetricsOverride", {
            width: 390,
            height: 844,
            deviceScaleFactor: 1,
            mobile: true,
          });
          return new Response(null, { status: 204 });
        }
        if (url.pathname === "/move-pane") {
          moved = true;
          publish({ type: "world_invalidated" });
          return new Response(null, { status: 204 });
        }
        if (url.pathname === "/fail-next-name") {
          failName = true;
          return new Response("ok");
        }
        if (url.pathname === "/result") {
          const result = (await request.json()) as {
            receiver: boolean;
            adapters?: boolean;
            failures: string[];
          };
          if (result.adapters) adapterResult.resolve(result.failures);
          else results[result.receiver ? 1 : 0]!.resolve(result.failures);
          return new Response("ok");
        }
        if (url.pathname === "/rpc") {
          const { method, params } = (await request.json()) as {
            method: string;
            params: Record<string, unknown>;
          };
          calls.push({ method, params: params ?? {} });
          if (method === "world.board.get")
            return Response.json({ result: board.get() });
          let reply: unknown, error: unknown;
          await handleAppearanceRpc({
            id: "browser",
            requestIsCurrent: () => !request.signal.aborted,
            method,
            params,
            sendReply: (message: Record<string, unknown>) => {
              reply = message.result;
              return true;
            },
            sendError: (_context: string, value: unknown) => {
              error = value;
            },
            services: {
              board: () => board,
              publishBoardChanged: (revision: number) =>
                publish({ type: "world_board_changed", revision }),
              publishWorldInvalidation: () =>
                publish({ type: "world_invalidated" }),
              connectionManager: {
                readyRuntimeLease: (connectionId: string) =>
                  connectionId !== "alpha"
                    ? null
                    : {
                        generation: 3,
                        isCurrent: () => true,
                        runtime: {
                          herdr: {
                            call: async (
                              method: string,
                              params: Record<string, unknown>,
                            ) => {
                              if (method === "pane.list")
                                return {
                                  panes: (destination ? [1, 2, 3] : [1, 2]).map(
                                    (number) => ({
                                      pane_id: `pane-${number}`,
                                      terminal_id: `terminal-${number}`,
                                      tab_id:
                                        number === 3 || (moved && number === 2)
                                          ? "tab-2"
                                          : "tab-1",
                                    }),
                                  ),
                                };
                              if (method === "tab.list")
                                return {
                                  tabs: [
                                    { tab_id: "tab-1", label },
                                    ...(destination
                                      ? [
                                          {
                                            tab_id: "tab-2",
                                            label: "Destination",
                                          },
                                        ]
                                      : []),
                                  ],
                                };
                              if (method === "workspace.list")
                                return {
                                  workspaces: [{ workspace_id: "space-1" }],
                                };
                              if (method === "tab.rename") {
                                if (failName) {
                                  failName = false;
                                  throw new Error(
                                    "Synthetic native rename refused",
                                  );
                                }
                                label = String(params.label);
                                return {};
                              }
                              throw new Error("unexpected native method");
                            },
                          },
                        },
                      },
              },
            },
          } as unknown as BridgeRpcContext);
          return Response.json(
            error ? { error: String(error) } : { result: reply },
          );
        }
        const asset = assets.get(url.pathname);
        if (asset) return new Response(asset);
        if (url.pathname === "/")
          return new Response(
            '<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/TerminalAppearance.browser.css"><div id="root"></div><script src="/TerminalAppearance.browser.js"></script>',
            { headers: { "Content-Type": "text/html" } },
          );
        return new Response("not found", { status: 404 });
      },
    });
    const children: ReturnType<typeof Bun.spawn>[] = [],
      sockets: WebSocket[] = [];
    async function start(
      name: string,
      width: number,
      height: number,
      receiver: boolean,
      adapters = false,
    ) {
      const profile = join(dir, name),
        log = join(dir, `${name}.log`);
      const child = Bun.spawn(
        [
          chrome!,
          "--headless=new",
          "--remote-debugging-port=0",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${profile}`,
          "about:blank",
        ],
        { stdout: "ignore", stderr: Bun.file(log) },
      );
      children.push(child);
      const port = await waitForChromePort(child, profile, log);
      const targets = (await fetch(`http://127.0.0.1:${port}/json/list`).then(
        (response) => response.json(),
      )) as { type: string; webSocketDebuggerUrl: string }[];
      const socket = new WebSocket(
        targets.find((target) => target.type === "page")!.webSocketDebuggerUrl,
      );
      sockets.push(socket);
      await withBrowserDeadline(
        new Promise<void>((resolve, reject) => {
          socket.onopen = () => resolve();
          socket.onerror = () =>
            reject(new Error("appearance debugger failed"));
        }),
        "appearance debugger",
      );
      let id = 0;
      const pending = new Map<
        number,
        {
          resolve(value: Record<string, unknown>): void;
          reject(error: Error): void;
        }
      >();
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data));
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message));
        else waiter.resolve(message.result);
      };
      const cdp = (method: string, params: Record<string, unknown> = {}) =>
        withBrowserDeadline(
          new Promise<Record<string, unknown>>((resolve, reject) => {
            pending.set(++id, { resolve, reject });
            socket.send(JSON.stringify({ id, method, params }));
          }),
          `appearance ${method}`,
        );
      await cdp("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: receiver,
      });
      await cdp("Page.navigate", {
        url: `${server.url.href}${adapters ? "?adapters=1" : receiver ? "?receiver=1" : ""}`,
      });
      return cdp;
    }
    try {
      const build = await Bun.build({
        entrypoints: [
          join(process.cwd(), "web/src/world/TerminalAppearance.browser.tsx"),
        ],
        outdir: dir,
        target: "browser",
        plugins: [
          {
            name: "raw-icons",
            setup(build) {
              build.onResolve({ filter: /\?raw$/ }, (args) => ({
                path: Bun.resolveSync(args.path.slice(0, -4), args.resolveDir),
                namespace: "raw",
              }));
              build.onLoad(
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
      if (!build.success)
        throw new AggregateError(build.logs, "appearance fixture build failed");
      for (const output of build.outputs)
        assets.set(`/${basename(output.path)}`, output);
      const desktop = await start("desktop", 1200, 900, false),
        phone = await start("phone", 375, 812, true);
      const outcomes = await withBrowserDeadline(
        Promise.all(results.map((result) => result.promise)),
        "two browser appearance exchange",
        30000,
      );
      expect(outcomes).toEqual([[], []]);
      for (const [name, cdp] of [
        ["desktop", desktop],
        ["phone", phone],
      ] as const) {
        await cdp("Runtime.evaluate", {
          expression:
            "document.querySelector('[data-pane=\"2\"] .mobile-appearance-button').click()",
        });
        await cdp("Runtime.evaluate", {
          awaitPromise: true,
          expression:
            "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
        });
        const measured = await cdp("Runtime.evaluate", {
          returnByValue: true,
          expression:
            "(()=>{const r=document.querySelector('.terminal-appearance-editor').getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight}})()",
        });
        const rect = (
          measured.result as {
            value: {
              x: number;
              y: number;
              right: number;
              bottom: number;
              width: number;
              height: number;
            };
          }
        ).value;
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.right).toBeLessThanOrEqual(rect.width);
        expect(rect.bottom).toBeLessThanOrEqual(rect.height);
        const shot = await cdp("Page.captureScreenshot", { format: "png" });
        await Bun.write(
          join(dir, `${name}.png`),
          Buffer.from(String(shot.data), "base64"),
        );
      }
      for (const socket of sockets) socket.close();
      await Promise.all(children.map((child) => stopChrome(child)));
      destination = true;
      calls.length = 0;
      board.patch([
        {
          op: "appearance.set",
          target: {
            connection_id: "alpha",
            kind: "tab",
            native_id: "tab-2",
            color_key: "alpha:tab-2",
            witness: ["terminal-3"],
          },
          fields: { status: "Destination status" },
        },
      ]);
      const adapter = await start("adapters", 1200, 900, false, true);
      adapterTools.resolve(adapter);
      expect(
        await withBrowserDeadline(
          adapterResult.promise,
          "actual Spaces and mobile appearance adapters",
          30000,
        ),
      ).toEqual([]);
    } finally {
      for (const socket of sockets) socket.close();
      for (const stream of events) {
        try {
          stream.close();
        } catch {}
      }
      server.stop(true);
      await Promise.all(children.map((child) => stopChrome(child)));
      // Keep requested visual evidence only; routine CI leaves no browser profiles.
      if (!Bun.env.APPEARANCE_KEEP_CAPTURE)
        await rm(dir, { recursive: true, force: true });
    }
  },
  60000 + BROWSER_STARTUP_TIMEOUT_MS,
);
