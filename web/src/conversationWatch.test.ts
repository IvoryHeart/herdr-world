import { expect, test } from "bun:test";
import { bridge, type BridgeControlMsg, type ConnectionClient } from "./api";
import { watchConversation } from "./conversationWatch";

test("views share one service watch per pane; the last to stop unwatches", () => {
  const controls = new Set<(control: BridgeControlMsg) => void>();
  bridge.onControl = (handler) => {
    controls.add(handler);
    return () => controls.delete(handler);
  };
  bridge.onStatus = () => () => {};
  const calls: string[] = [];
  const client = {
    connectionId: "conn-a",
    generation: 1,
    serverRuntimeGeneration: 4,
    isCurrent: () => true,
    acceptsServerGeneration: () => true,
    call: async (method: string, params?: Record<string, unknown>) => {
      calls.push(`${method} ${String(params?.pane_id)}`);
      return { ok: true };
    },
  } satisfies ConnectionClient;
  const push = (control: Partial<BridgeControlMsg>) =>
    controls.forEach((handler) =>
      handler({
        type: "agent_conversation_changed",
        connection_id: "conn-a",
        pane_id: "p1",
        ...control,
      } as BridgeControlMsg),
    );
  let chat = 0;
  let peek = 0;
  const stopChat = watchConversation(client, "p1", () => chat++);
  const stopPeek = watchConversation(client, "p1", () => peek++);
  expect(calls).toEqual(["agent_conversation.watch p1"]);
  push({});
  expect([chat, peek]).toEqual([1, 1]);
  // Another connection, pane or runtime generation is not this pane.
  push({ connection_id: "conn-b" });
  push({ pane_id: "p2" });
  push({ connection_generation: 3 });
  expect([chat, peek]).toEqual([1, 1]);
  stopChat();
  expect(calls).toEqual(["agent_conversation.watch p1"]);
  push({});
  expect([chat, peek]).toEqual([1, 2]);
  stopPeek();
  expect(calls).toEqual([
    "agent_conversation.watch p1",
    "agent_conversation.unwatch p1",
  ]);
  expect(controls.size).toBe(0);
});
