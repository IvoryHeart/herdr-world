import type { ConnectionClient } from "../api";
import type { WorldLeafObject } from "../world/worldObject";

/** Runs only after the real entry has mounted and canonicalized its URL. */
export async function checkAgentInputPreview() {
  if (location.pathname !== "/town")
    throw new Error(
      `Expected /town after root routing, got ${location.pathname}`,
    );
  if (new URL(location.href).searchParams.has("agentInputGuard"))
    throw new Error("Refusal switch was not consumed before routing");
  const { bridge } = await import("../api");
  const { sendTownReply } = await import("../world/town/townChat");
  const { sendAgentInput, agentInputFailureNotice } = await import(
    "../agentInput"
  );
  let runtimeSends = 0;
  let refusals = 0;
  const originalConnection = bridge.connection;
  const client = (connectionId: string): ConnectionClient => ({
    connectionId,
    generation: 1,
    serverRuntimeGeneration: 7,
    isCurrent: () => true,
    acceptsServerGeneration: (generation) => generation === 7,
    call: async () => {
      runtimeSends++;
      return {};
    },
  });
  const clients = new Map([
    ["synthetic-tui", client("synthetic-tui")],
    ["synthetic-core", client("synthetic-core")],
  ]);
  bridge.connection = (id, ...args) =>
    (id === undefined ? undefined : clients.get(id)) ??
    originalConnection.call(bridge, id, ...args);
  const refuse = async (send: () => Promise<unknown>, text: string) => {
    try {
      await send();
    } catch (error) {
      const notice = agentInputFailureNotice(text, error);
      if (!notice.detail?.includes("Nothing was sent")) throw error;
      if (notice.message !== "Not sent" || notice.actionClipboardText !== text)
        throw new Error("Refusal lost its Not sent / Copy recovery", {
          cause: error,
        });
      refusals++;
      return;
    }
    throw new Error("Preview input was delivered instead of refused");
  };
  try {
    for (const [connectionId, target] of clients) {
      const leaf = {
        connectionId,
        generation: 7,
        pane: { pane_id: "w1:p1" },
      } as WorldLeafObject;
      await refuse(
        () => sendTownReply(leaf, "Please fix this", true),
        "Please fix this",
      );
      await refuse(() => sendTownReply(leaf, "1", false), "1");
      const feedback = "Review feedback:\n`src/example.ts`\n> quoted content";
      await refuse(
        () => sendAgentInput(target, "w1:p1", feedback, false),
        feedback,
      );
    }
    // Later navigation may discard every query parameter. It cannot reset the
    // captured refusal, including when the lazy sender is used on another view.
    history.replaceState(history.state, "", "/board");
    await refuse(
      () =>
        sendAgentInput(
          clients.get("synthetic-tui")!,
          "w1:p1",
          "after navigation",
          true,
        ),
      "after navigation",
    );
    history.replaceState(history.state, "", "/town");
    return { runtimeSends, refusals };
  } finally {
    bridge.connection = originalConnection;
  }
}
