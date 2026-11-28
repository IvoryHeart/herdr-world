import type { ChromePage } from "../../testing/sharedChrome";

/**
 * A WebSocket URL that speaks CDP to `page` alone, for a second client that
 * must stay independent of the test's main thread (the dense suites' input
 * worker). With the runner's shared Chrome that is the page's own DevTools
 * endpoint; a file run on its own has no published port, so a small relay
 * forwards the client's commands to the page's session instead.
 */
export async function pageCdpEndpoint(
  page: ChromePage,
): Promise<{ url: string; stop(): void }> {
  const shared = page.sharedEndpoint;
  if (shared) {
    const { targetInfo } = await page.command("Target.getTargetInfo");
    return {
      url: `ws://${new URL(shared).host}/devtools/page/${targetInfo.targetId}`,
      stop: () => {},
    };
  }
  const relay = Bun.serve<{ off?: () => void }>({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request, { data: {} })) return;
      return new Response("CDP relay", { status: 426 });
    },
    websocket: {
      open(socket) {
        socket.data.off = page.on("Tracing.tracingComplete", (params) =>
          socket.send(
            JSON.stringify({ method: "Tracing.tracingComplete", params }),
          ),
        );
      },
      async message(socket, raw) {
        const { id, method, params } = JSON.parse(String(raw));
        try {
          socket.send(
            JSON.stringify({ id, result: await page.command(method, params) }),
          );
        } catch (error) {
          socket.send(
            JSON.stringify({
              id,
              error: { message: (error as Error).message },
            }),
          );
        }
      },
      close(socket) {
        socket.data.off?.();
      },
    },
  });
  return { url: `ws://127.0.0.1:${relay.port}/`, stop: () => relay.stop(true) };
}
