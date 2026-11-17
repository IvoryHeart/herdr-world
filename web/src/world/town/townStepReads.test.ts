import { expect, test } from "bun:test";
import type { ConnectionClient } from "../../api";
import type { WorldLeafObject } from "../worldObject";
import { TownStepStore } from "./townStepStore";
import { TOWN_STEP_BATCH, TownStepReads } from "./useTownStepReads";

const leaf = (id: string, agent = "claude") =>
  ({
    id,
    kind: "agent",
    connectionId: "example",
    generation: 1,
    status: "working",
    pane: { pane_id: `pane-${id}`, agent },
  }) as unknown as WorldLeafObject;

const reply = (paneId: string, tool: string | null, fields = {}) => ({
  pane_id: paneId,
  status: "ok",
  agent: "claude",
  agent_status: "working",
  session_binding: "reported",
  terminal_title: "✳ Fix login redirect",
  running_tool: tool
    ? {
        id: "c1",
        name: tool,
        summary: null,
        started_at: "2026-11-08T10:00:00.000Z",
      }
    : null,
  ...fields,
});

function setup(leaves: WorldLeafObject[]) {
  const calls: { method: string; params: { pane_ids: string[] } }[] = [];
  let answer: (params: { pane_ids: string[] }) => unknown = () => ({
    conversations: [],
  });
  const client = {
    connectionId: "example",
    generation: 1,
    isCurrent: () => true,
    call: async (method: string, params: { pane_ids: string[] }) => {
      calls.push({ method, params });
      return answer(params);
    },
  } as unknown as ConnectionClient;
  const watched = new Map<string, () => void>();
  const store = new TownStepStore();
  const byId = new Map(leaves.map((entry) => [entry.id, entry]));
  const reads = new TownStepReads(store, (key) => byId.get(key), {
    clientFor: () => client,
    batchMs: 0,
    watch: (_client, paneId, onChange) => {
      watched.set(paneId, onChange);
      return () => void watched.delete(paneId);
    },
  });
  store.onWant(() => reads.sync());
  return {
    store,
    reads,
    calls,
    watched,
    answer: (next: typeof answer) => (answer = next),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

test("Town reads and watches only the agents it wants, in one call per connection", async () => {
  const { store, calls, watched, answer } = setup([
    leaf("a"),
    leaf("b"),
    leaf("c"),
  ]);
  answer(({ pane_ids }) => ({
    conversations: pane_ids.map((id) => reply(id, "Edit")),
  }));
  store.want(["a", "b"]);
  await settle();
  expect([...watched.keys()]).toEqual(["pane-a", "pane-b"]);
  expect(calls).toEqual([
    {
      method: "agent_conversation.latest",
      params: { pane_ids: ["pane-a", "pane-b"] },
    },
  ]);
  expect(store.get("a")?.kind).toBe("edit");
  expect(store.get("c")).toBeUndefined();
  // An agent no longer wanted is unwatched and loses its step.
  store.want(["b"]);
  expect([...watched.keys()]).toEqual(["pane-b"]);
  expect(store.get("a")).toBeUndefined();
});

test("a change the service reports reads that agent again, and its bubble follows", async () => {
  const { store, calls, watched, answer } = setup([leaf("a")]);
  answer(({ pane_ids }) => ({
    conversations: pane_ids.map((id) => reply(id, "Read")),
  }));
  store.want(["a"]);
  await settle();
  expect(store.get("a")?.kind).toBe("read");
  answer(({ pane_ids }) => ({
    conversations: pane_ids.map((id) =>
      reply(id, "Bash", {
        running_tool: {
          id: "c2",
          name: "Bash",
          summary: "bun test",
          started_at: "2026-11-08T10:05:00.000Z",
        },
      }),
    ),
  }));
  watched.get("pane-a")!();
  await settle();
  expect(calls).toHaveLength(2);
  expect(store.get("a")).toEqual({
    kind: "test",
    since: Date.parse("2026-11-08T10:05:00.000Z"),
    task: "bun test",
  });
});

test("a guessed session, an unknown harness or a failed read shows no new step", async () => {
  const { store, watched, answer } = setup([leaf("a"), leaf("g", "grok")]);
  answer(({ pane_ids }) => ({
    conversations: pane_ids.map((id) =>
      id === "pane-g"
        ? reply(id, "Edit", { agent: "grok" })
        : reply(id, "Edit", { session_binding: "guessed" }),
    ),
  }));
  store.want(["a", "g"]);
  await settle();
  expect(store.get("a")).toBeUndefined();
  expect(store.get("g")).toBeUndefined();
  answer(({ pane_ids }) => ({
    conversations: pane_ids.map((id) => reply(id, "Edit")),
  }));
  watched.get("pane-a")!();
  await settle();
  expect(store.get("a")?.kind).toBe("edit");
  // A failed read keeps the last step.
  answer(() => {
    throw new Error("offline");
  });
  watched.get("pane-a")!();
  await settle();
  expect(store.get("a")?.kind).toBe("edit");
});

test("the scale scene's agents show synthetic steps without any read", async () => {
  const store = new TownStepStore();
  const reads = new TownStepReads(store, (key) => leaf(key), {
    clientFor: () => {
      throw new Error("the scene read a connection");
    },
    sceneStep: () => ({ kind: "test", since: 0, task: "Synthetic" }),
  });
  store.onWant(() => reads.sync());
  store.want(["a"]);
  expect(store.get("a")?.task).toBe("Synthetic");
  reads.dispose();
  expect(store.get("a")).toBeUndefined();
});

test("a change during a read waits for it, even with a fresh client per lookup, so the newest step wins", async () => {
  // bridge.connection() returns a new client object on every lookup.
  const calls: string[] = [];
  const replies: ((value: unknown) => void)[] = [];
  const clientFor = () =>
    ({
      connectionId: "example",
      generation: 1,
      isCurrent: () => true,
      call: (_method: string, { pane_ids }: { pane_ids: string[] }) => {
        calls.push(pane_ids.join());
        return new Promise((resolve) => replies.push(resolve));
      },
    }) as unknown as ConnectionClient;
  const watched = new Map<string, () => void>();
  const store = new TownStepStore();
  const reads = new TownStepReads(store, () => leaf("a"), {
    clientFor,
    batchMs: 0,
    watch: (_client, paneId, onChange) => {
      watched.set(paneId, onChange);
      return () => void watched.delete(paneId);
    },
  });
  store.onWant(() => reads.sync());
  store.want(["a"]);
  await settle();
  expect(calls).toHaveLength(1);
  // The agent moves on while the first read is still out.
  watched.get("pane-a")!();
  await settle();
  expect(calls).toHaveLength(1);
  replies[0]!({ conversations: [reply("pane-a", "Edit")] });
  await settle();
  expect(store.get("a")?.kind).toBe("edit");
  expect(calls).toHaveLength(2);
  replies[1]!({ conversations: [reply("pane-a", "Read")] });
  await settle();
  expect(store.get("a")?.kind).toBe("read");
});

test("every working agent on screen is read, in turns of at most TOWN_STEP_BATCH", async () => {
  // A full room: fifteen four-seat desks, sixty working agents.
  const leaves = Array.from({ length: 60 }, (_, index) => leaf(`k${index}`));
  const { store, calls, answer } = setup(leaves);
  answer(({ pane_ids }) => ({
    conversations: pane_ids.map((id) => reply(id, "Edit")),
  }));
  store.want(leaves.map((entry) => entry.id));
  await settle();
  await settle();
  expect(calls.map((call) => call.params.pane_ids.length)).toEqual([
    TOWN_STEP_BATCH,
    60 - TOWN_STEP_BATCH,
  ]);
  for (const entry of leaves) expect(store.get(entry.id)?.kind).toBe("edit");
});
