import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { ConnectionClient } from "./api";

test("preview refusal removes its switch and never calls the runtime", async () => {
  const browser = new Window({
    url: "https://world.example.test/?agentInputGuard=refused&keep=1#town",
  });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    value: browser,
    configurable: true,
  });
  try {
    // The eager entry captures the switch; lazy senders load after routing.
    await import("./agentInputPreview");
    expect(browser.location.href).toBe(
      "https://world.example.test/?keep=1#town",
    );
    browser.history.replaceState(null, "", "/town");
    const { sendAgentInput } = await import("./agentInput");
    let writes = 0;
    const client = {
      isCurrent: () => true,
      call: async () => {
        writes++;
      },
    } as unknown as ConnectionClient;
    for (const submit of [false, true])
      await expect(
        sendAgentInput(client, "w1:p1", "unsent text", submit),
      ).rejects.toThrow("shell now");
    expect(writes).toBe(0);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
    await browser.happyDOM.close();
  }
});
