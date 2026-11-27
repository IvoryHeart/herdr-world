import { describe, expect, test } from "bun:test";
import { WorldRuntimeStore, type WorldRuntimeConnection } from "./runtimeStore";
import {
  pendingNames,
  presentPending,
  type WorldCommand,
} from "./worldReplica";

const command = (over: Partial<WorldCommand> = {}): WorldCommand => ({
  id: "cmd-1",
  entity: {
    kind: "room",
    connection_id: "host-a",
    generation: 1,
    room_id: "shared",
  },
  field: "name",
  expected: "Old",
  value: "New",
  state: "accepted",
  ...over,
});

function publication(
  revision: number,
  label: string,
  commands: unknown[] = [],
  incarnation = "synthetic-incarnation-1",
) {
  return {
    service_incarnation: incarnation,
    revision,
    observed_at: 100 + revision,
    commands,
    ui_settings: { ui: { townReception: { revision } }, revision },
    connections: [
      {
        connection_id: "host-a",
        label: "Host A",
        source: "saved-profile",
        is_default: false,
        state: "ready",
        generation: 1,
        snapshot_generation: 1,
        stale: false,
        actionable: true,
        runtime: "herdr-core",
        snapshot: {
          workspaces: [
            {
              workspace_id: "shared",
              number: 1,
              label,
              focused: true,
              pane_count: 0,
              tab_count: 0,
              agent_status: "idle",
            },
          ],
          tabs: [],
          panes: [],
          agents: [],
          coverage: {
            workspaces: 1,
            tabs: 0,
            panes: 0,
            agent_panes: 0,
            status: { working: 0, idle: 0, blocked: 0, done: 0, unknown: 0 },
            by_workspace: [],
          },
        },
      },
    ],
  };
}

/** One browser's replica over a scripted World: each read takes the next reply. */
function replica() {
  const replies: Array<(value: unknown) => void> = [];
  const store = new WorldRuntimeStore({
    call: () => new Promise((resolve) => void replies.push(resolve)),
    onControl: () => () => undefined,
    onStatus: () => () => undefined,
  });
  const name = () => store.get().connections[0]?.snapshot?.workspaces[0]?.label;
  /** Start a read now; answer it later. */
  const read = () => {
    const done = store.refresh();
    const reply = replies[replies.length - 1]!;
    return {
      answer: async (value: unknown) => {
        reply(value);
        await done;
      },
    };
  };
  return { store, name, read };
}

describe("World replica", () => {
  test("pending names: published in-progress commands, then this browser's own", () => {
    const published = [
      command({ id: "a", value: "From another browser", state: "sent" }),
      command({
        id: "b",
        entity: { ...command().entity, room_id: "other" },
        state: "observed",
      }),
    ];
    expect([...pendingNames([], published).values()]).toEqual([
      "From another browser",
    ]);
    expect([
      ...pendingNames([command({ value: "Mine" })], published).values(),
    ]).toEqual(["Mine"]);
  });

  test("presentation reuses published connections and its own overlays", () => {
    const connection = {
      connectionId: "host-a",
      generation: 1,
      snapshot: { workspaces: [{ workspace_id: "shared", label: "Old" }] },
    } as unknown as WorldRuntimeConnection;
    const none = [connection];
    expect(presentPending(none, new Map())).toBe(none);
    const names = pendingNames([command()], []);
    const first = presentPending(none, names);
    expect(first[0]?.snapshot?.workspaces[0]?.label).toBe("New");
    expect(presentPending(none, names)[0]).toBe(first[0]);
    // A stale generation's pending name never lands on the new host.
    const later = { ...connection, generation: 2 } as WorldRuntimeConnection;
    expect(presentPending([later], names)[0]).toBe(later);
  });

  test("a pending name never flashes back, and settles to the confirmed one", async () => {
    const { store, name, read } = replica();
    await read().answer(publication(1, "Old"));
    expect(name()).toBe("Old");
    const outcomes: Array<WorldCommand | null> = [];
    const held = store.holdPending(command(), (outcome) =>
      outcomes.push(outcome),
    );
    expect(name()).toBe("New");
    // A read that began before World answered still shows the old name.
    const before = read();
    held.answered();
    await before.answer(publication(2, "Old"));
    expect(name()).toBe("New");
    // World publishes the command in progress: still pending.
    await read().answer(publication(3, "Old", [command({ state: "sent" })]));
    expect(name()).toBe("New");
    expect(outcomes).toEqual([]);
    // The settle arrives with the confirmed value in the same revision.
    await read().answer(
      publication(4, "New", [command({ state: "stored", observed: "New" })]),
    );
    expect(name()).toBe("New");
    expect(outcomes).toMatchObject([{ state: "stored" }]);
  });

  test("an older revision never replaces a newer one", async () => {
    const { store, name, read } = replica();
    await read().answer(publication(5, "Newer"));
    // A reply carrying an older publication (a lagging read) is not adopted.
    await read().answer(publication(3, "Older"));
    expect(name()).toBe("Newer");
    expect(store.get().uiSettings?.revision).toBe(5);
  });

  test("a refused or different outcome shows the observed name again", async () => {
    const { store, name, read } = replica();
    await read().answer(publication(1, "Old"));
    const outcomes: Array<WorldCommand | null> = [];
    store
      .holdPending(command(), (outcome) => outcomes.push(outcome))
      .answered();
    await read().answer(
      publication(2, "Other", [
        command({
          state: "observed",
          observed: "Other",
          detail: "The room shows another name.",
        }),
      ]),
    );
    expect(name()).toBe("Other");
    expect(outcomes).toMatchObject([{ state: "observed", observed: "Other" }]);
  });

  test("a restarted World drops the pending value and says so", async () => {
    const { store, name, read } = replica();
    await read().answer(publication(1, "Old"));
    const outcomes: Array<WorldCommand | null> = [];
    store.holdPending(command(), (outcome) => outcomes.push(outcome));
    await read().answer(publication(1, "Old", [], "synthetic-incarnation-2"));
    expect(name()).toBe("Old");
    expect(outcomes).toEqual([null]);
  });

  test("pending names from another browser's command show in this one", async () => {
    const { name, read } = replica();
    await read().answer(
      publication(1, "Old", [
        command({ id: "theirs", value: "Theirs", state: "sent" }),
      ]),
    );
    expect(name()).toBe("Theirs");
    await read().answer(
      publication(2, "Theirs", [
        command({
          id: "theirs",
          value: "Theirs",
          state: "observed",
          observed: "Theirs",
        }),
      ]),
    );
    expect(name()).toBe("Theirs");
  });
});
