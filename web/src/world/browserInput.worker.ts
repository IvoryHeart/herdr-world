import { InputDriver } from "./browserAcceptanceFixture";
import { startIndependentInput } from "./independentInputSchedule";

let driver: InputDriver;
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
          ]),
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
      self.postMessage({ id, result: { count: run.pending.length, hotspots } });
    }
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
