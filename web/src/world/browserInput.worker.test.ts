import { expect, test } from "bun:test";

test.each([true, false])(
  "independent input records dispatch timings=%s without a Chrome timeline",
  async (timings) => {
    const requests: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request, server) => {
        if (server.upgrade(request)) return;
        return new Response("Not found", { status: 404 });
      },
      websocket: {
        message(socket, raw) {
          const request = JSON.parse(String(raw));
          requests.push(request.method);
          socket.send(JSON.stringify({ id: request.id, result: {} }));
        },
      },
    });
    const worker = new Worker(
      new URL("./browserInput.worker.ts", import.meta.url).href,
    );
    const inputs: { sequence: number }[] = [];
    const dispatches: {
      phase: string;
      sequence: number;
      cdpSentAt: number;
      cdpCompleteAt: number;
    }[] = [];
    const commands = new Map<
      string,
      ReturnType<typeof Promise.withResolvers<any>>
    >();
    const received = Promise.withResolvers<void>();
    const deadline = Promise.withResolvers<never>();
    const timeout = setTimeout(
      () => deadline.reject(Error("Independent input worker did not respond")),
      5000,
    );
    worker.onmessage = ({ data }) => {
      if (data.error) {
        received.reject(Error(data.error));
        commands.get(data.id)?.reject(Error(data.error));
      } else if (data.input) {
        inputs.push(data.input);
        if (inputs.length >= 2) received.resolve();
      } else if (data.dispatch) dispatches.push(data.dispatch);
      else commands.get(data.id)?.resolve(data.result);
    };
    worker.onerror = () => received.reject(Error("Input worker failed"));
    try {
      const start = Promise.withResolvers<any>();
      commands.set("start", start);
      worker.postMessage({
        id: "start",
        action: "start",
        phase: "timing-probe",
        url: server.url.href.replace("http:", "ws:"),
        timings,
      });
      await Promise.race([
        Promise.all([start.promise, received.promise]),
        deadline.promise,
      ]);
      const stop = Promise.withResolvers<any>();
      commands.set("stop", stop);
      worker.postMessage({
        id: "stop",
        action: "stop",
        phase: "timing-probe",
      });
      const result = await Promise.race([stop.promise, deadline.promise]);
      expect(result.count).toBe(inputs.length);
      expect(dispatches).toHaveLength(timings ? inputs.length : 0);
      for (const dispatch of dispatches) {
        expect(dispatch.phase).toBe("timing-probe");
        expect(dispatch.cdpCompleteAt).toBeGreaterThanOrEqual(
          dispatch.cdpSentAt,
        );
      }
      expect(requests).toContain("Input.dispatchKeyEvent");
      expect(requests.some((method) => method.startsWith("Tracing."))).toBe(
        false,
      );
    } finally {
      clearTimeout(timeout);
      worker.terminate();
      server.stop(true);
    }
  },
  15000,
);
