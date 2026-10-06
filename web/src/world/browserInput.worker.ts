import { InputDriver } from "./browserAcceptanceFixture";
import { startIndependentInput } from "./independentInputSchedule";

let driver: InputDriver;
let traceComplete: ReturnType<typeof Promise.withResolvers<string>>;
const runs = new Map<
  string,
  {
    stop(): void;
    pending: Promise<unknown>[];
  }
>();
self.onmessage = async ({ data }) => {
  const { id, action, phase, url, profile, slowdown } = data;
  try {
    if (action === "start") {
      if (!driver) {
        const socket = new WebSocket(url);
        socket.addEventListener("message", (event) => {
          const message = JSON.parse(String(event.data));
          if (message.method === "Tracing.tracingComplete")
            traceComplete.resolve(message.params.stream);
        });
        await new Promise<void>((resolve, reject) => {
          socket.onopen = () => resolve();
          socket.onerror = () => reject(Error("CDP unavailable"));
        });
        driver = new InputDriver(socket);
        if (slowdown > 1)
          await driver.call("Emulation.setCPUThrottlingRate", {
            rate: slowdown,
          });
      }
      if (data.tracePath) {
        traceComplete = Promise.withResolvers<string>();
        await driver.call("Tracing.start", {
          categories:
            "devtools.timeline,v8,v8.execute,blink.user_timing,gpu,cc,viz,netlog,network,ipc,toplevel.flow,disabled-by-default-ipc.flow,disabled-by-default-gpu.service,disabled-by-default-devtools.timeline,disabled-by-default-v8.gc,disabled-by-default-v8.cpu_profiler",
          transferMode: "ReturnAsStream",
        });
      }
      if (profile) {
        await driver.call("Profiler.enable", {});
        await driver.call("Profiler.start", {});
      }
      await driver.call("Runtime.evaluate", {
        expression:
          "document.querySelector('[data-host=beta] .xterm-helper-textarea').focus()",
      });
      const run = {
        stop: () => {},
        pending: [] as Promise<unknown>[],
      };
      const emit = (input: {
        sequence: number;
        dueAt: number;
        sentAt: number;
      }) => {
        self.postMessage({
          input: {
            phase,
            ...input,
          },
        });
        // Send the ordered key pair together; protocol acknowledgements do not
        // gate later independently timed user intents.
        const cdpSentAt = Date.now();
        run.pending.push(
          Promise.all([
            driver.call("Input.dispatchKeyEvent", {
              type: "keyDown",
              key: "z",
              code: "KeyZ",
              text: "z",
              windowsVirtualKeyCode: 90,
            }),
            driver.call("Input.dispatchKeyEvent", {
              type: "keyUp",
              key: "z",
              code: "KeyZ",
              windowsVirtualKeyCode: 90,
            }),
          ]).then(() => {
            if (data.timings || data.tracePath)
              self.postMessage({
                dispatch: {
                  phase,
                  sequence: input.sequence,
                  cdpSentAt,
                  cdpCompleteAt: Date.now(),
                },
              });
          }),
        );
      };
      run.stop = startIndependentInput(emit);
      runs.set(phase, run);
      self.postMessage({ id, result: "ready" });
    } else {
      const run = runs.get(phase)!;
      run.stop();
      await Promise.all(run.pending);
      let hotspots: unknown[] | undefined;
      if (profile) {
        const result = (await driver.call("Profiler.stop", {})) as {
          profile: {
            nodes: { id: number; callFrame: { functionName: string } }[];
            samples: number[];
            timeDeltas: number[];
          };
        };
        const nodes = new Map(
          result.profile.nodes.map((node) => [node.id, node]),
        );
        const time = new Map<string, number>();
        result.profile.samples.forEach((sample: number, index: number) => {
          const name =
            nodes.get(sample)?.callFrame.functionName || "(anonymous)";
          time.set(
            name,
            (time.get(name) ?? 0) + (result.profile.timeDeltas[index] ?? 0),
          );
        });
        hotspots = [...time]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12)
          .map(([name, us]) => ({ name, ms: us / 1000 }));
      }
      if (data.tracePath) {
        await driver.call("Tracing.end", {});
        const handle = await traceComplete.promise;
        const chunks: string[] = [];
        while (true) {
          const part = (await driver.call("IO.read", { handle })) as {
            data: string;
            eof: boolean;
          };
          chunks.push(part.data);
          if (part.eof) break;
        }
        await driver.call("IO.close", { handle });
        await Bun.write(data.tracePath, chunks.join(""));
      }
      self.postMessage({ id, result: { count: run.pending.length, hotspots } });
    }
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
