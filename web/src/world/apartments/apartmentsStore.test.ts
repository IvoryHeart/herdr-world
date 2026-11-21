import { describe, expect, test } from "bun:test";
import type { BridgeControlMsg, ConnectionStatus } from "../../api";
import { fixtureResidents } from "../testing/apartmentsFixture";
import {
  type ApartmentsClient,
  parseApartmentState,
  WorldApartmentsStore,
} from "./apartmentsStore";

const NOW = 1_800_000_000_000;

function client(replies: unknown[]) {
  const controls = new Set<(control: BridgeControlMsg) => void>();
  const statuses = new Set<(status: ConnectionStatus) => void>();
  const calls: string[] = [];
  const fake: ApartmentsClient = {
    async call(method) {
      calls.push(method);
      return replies.shift();
    },
    onControl(callback) {
      controls.add(callback);
      return () => controls.delete(callback);
    },
    onStatus(callback) {
      statuses.add(callback);
      return () => statuses.delete(callback);
    },
  };
  return {
    fake,
    calls,
    control: (type: string) =>
      controls.forEach((callback) =>
        callback({ type } as unknown as BridgeControlMsg),
      ),
    status: (status: ConnectionStatus) =>
      statuses.forEach((callback) => callback(status)),
    listening: () => controls.size + statuses.size,
  };
}

const state = (revision: number, count = 1) => ({
  revision,
  residents: fixtureResidents(NOW).slice(0, count),
  capacity: 500,
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Apartments in the browser", () => {
  test("replies are checked field by field; unsafe links lose their URL", () => {
    expect(parseApartmentState(null)).toBeNull();
    expect(parseApartmentState({ revision: "1", residents: [] })).toBeNull();
    const [resident] = fixtureResidents(NOW);
    const parsed = parseApartmentState({
      ...state(3),
      residents: [
        {
          ...resident,
          links: [
            { kind: "pr", number: 1, url: "javascript:alert(1)" },
            { kind: "pr", number: -2 },
          ],
        },
        { ...resident, id: "" },
      ],
    });
    expect(parsed?.residents).toHaveLength(1);
    expect(parsed?.residents[0]!.links).toEqual([{ kind: "pr", number: 1 }]);
  });

  test("a resident's usage agent IDs are kept; bad or missing ones read as none", () => {
    const [resident] = fixtureResidents(NOW);
    const parsed = parseApartmentState({
      ...state(3),
      residents: [
        { ...resident, usage_agent_ids: ["agent_a", 7, "", "agent_b"] },
        { ...resident, id: "r-old", usage_agent_ids: undefined },
        { ...resident, id: "r-bad", usage_agent_ids: "agent_a" },
      ],
    });
    expect(parsed?.residents.map((item) => item.usage_agent_ids)).toEqual([
      ["agent_a", "agent_b"],
      [],
      [],
    ]);
  });

  test("refreshes on the service's change message and ignores an older revision", async () => {
    const io = client([state(2, 1), state(3, 2), state(1, 5)]);
    const store = new WorldApartmentsStore(io.fake);
    store.start();
    await tick();
    expect(store.get()).toMatchObject({ revision: 2, verified: true });
    io.control("world_apartments_changed");
    await tick();
    expect(store.get().residents).toHaveLength(2);
    io.control("world_apartments_changed");
    await tick();
    expect(store.get().residents).toHaveLength(2);
    io.control("something_else");
    expect(io.calls).toHaveLength(3);
  });

  test("a reconnect re-reads, even when the service restarted its revisions", async () => {
    const io = client([state(5, 1), state(1, 3)]);
    const store = new WorldApartmentsStore(io.fake);
    store.start();
    await tick();
    io.status("disconnected");
    expect(store.get().verified).toBe(false);
    io.status("connected");
    await tick();
    expect(store.get()).toMatchObject({ revision: 1, verified: true });
    expect(store.get().residents).toHaveLength(3);
  });

  test("the last viewer to leave ends the subscription", () => {
    const io = client([state(1), state(1)]);
    const store = new WorldApartmentsStore(io.fake);
    store.start();
    store.start();
    store.stop();
    expect(io.listening()).toBe(2);
    store.stop();
    expect(io.listening()).toBe(0);
  });
});
