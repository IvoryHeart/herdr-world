import { InputDriver } from "./browserAcceptanceFixture";

let driver: InputDriver;
const runs = new Map<
  string,
  {
    first: ReturnType<typeof setTimeout>;
    interval?: ReturnType<typeof setInterval>;
    pending: Promise<unknown>[];
  }
>();
self.onmessage = async ({ data }) => {
  const { id, action, phase, url } = data;
  try {
    if (action === "start") {
      if (!driver) {
        const socket = new WebSocket(url);
        await new Promise<void>((resolve, reject) => {
          socket.onopen = () => resolve();
          socket.onerror = () => reject(Error("CDP unavailable"));
        });
        driver = new InputDriver(socket);
      }
      await driver.call("Runtime.evaluate", {
        expression:
          "document.querySelector('[data-host=beta] .xterm-helper-textarea').focus()",
      });
      const began = Date.now();
      let index = 0;
      const run = {
        first: 0 as unknown as ReturnType<typeof setTimeout>,
        interval: undefined as ReturnType<typeof setInterval> | undefined,
        pending: [] as Promise<unknown>[],
      };
      const emit = () => {
        const sequence = index++;
        self.postMessage({
          input: {
            phase,
            sequence,
            dueAt: began + 5 + sequence * 75,
            sentAt: Date.now(),
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
      run.first = setTimeout(() => {
        emit();
        run.interval = setInterval(emit, 75);
      }, 5);
      runs.set(phase, run);
      self.postMessage({ id, result: "ready" });
    } else {
      const run = runs.get(phase)!;
      clearTimeout(run.first);
      clearInterval(run.interval);
      await Promise.all(run.pending);
      self.postMessage({ id, result: { count: run.pending.length } });
    }
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
