import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore, parseBoardDocument } from "./board-store";

let root: string;
let path: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "world-groups-"));
  path = join(root, "board.json");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const terminal = (id: string) => ({ connection_id: "studio", terminal_id: id });
const member = (ref: string, roles: string[] = []) => ({ ref, roles });

describe("stored Groups", () => {
  test("migrates legacy magnetic groups in place without writing or revising on read", () => {
    const document = new BoardStore(path).get();
    const legacy = {
      ...document,
      revision: 12,
      relations: {
        spawns: [],
        groups: [
          { id: "g1", members: [terminal("a"), terminal("b")], created_at: 7 },
        ],
      },
    };
    const saved = JSON.stringify(legacy);
    writeFileSync(path, saved);
    const store = new BoardStore(path);
    expect(store.get().revision).toBe(12);
    expect(store.get().relations.groups[0]).toMatchObject({
      id: "g1",
      kind: "team",
      created_at: 7,
      members: [
        { ref: terminal("a"), roles: [], joined_at: 7 },
        { ref: terminal("b"), roles: [], joined_at: 7 },
      ],
    });
    expect(readFileSync(path, "utf8")).toBe(saved);
    store.patch([{ op: "group.leave", members: [terminal("a")] }]);
    expect(new BoardStore(path).get().relations.groups).toEqual([]);
  });

  test("pods keep address membership and intent across pruning, restart, and deletion", () => {
    const store = new BoardStore(path, { now: () => 42 });
    store.patch([
      {
        op: "group.create",
        id: "pod-chat",
        kind: "pod",
        name: "Chat",
        members: [
          member("agent://studio/peek", ["lead"]),
          member("agent://remote/rev4", ["reviewer"]),
        ],
        attrs: { open_pr_limit: 2, queue: ["#43", "Chat windows"] },
        sender: { label: "FirstMate", basis: "reported", via: "cli" },
      },
    ]);
    store.patch([
      { op: "relations.prune", children: [], members: [terminal("old-seat")] },
    ]);
    const saved = new BoardStore(path).get();
    expect(saved.relations.groups[0]).toMatchObject({
      kind: "pod",
      name: "Chat",
      created_at: 42,
      members: [
        { ref: "agent://studio/peek", roles: ["lead"] },
        { ref: "agent://remote/rev4", roles: ["reviewer"] },
      ],
      attrs: { open_pr_limit: 2, queue: ["#43", "Chat windows"] },
    });
    store.patch([{ op: "group.delete", id: "pod-chat" }]);
    expect(store.get().relations.groups).toEqual([]);
    expect(store.get().relations.group_changes!.at(-1)).toMatchObject({
      group_id: "pod-chat",
      op: "group.delete",
      revision: 3,
      sender: { basis: "unknown" },
    });
    expect(
      new BoardStore(path).get().relations.group_changes![0],
    ).toMatchObject({
      group_id: "pod-chat",
      sender: { label: "FirstMate", basis: "reported", via: "cli" },
    });
  });

  test("Herdr-owned rooms and desks cannot enter the persisted group store", () => {
    for (const kind of ["room", "desk"]) {
      const store = new BoardStore(path);
      expect(() =>
        store.patch([{ op: "group.create", id: "projected", kind }]),
      ).toThrow("Herdr");
      const document = store.get();
      expect(() =>
        parseBoardDocument({
          ...document,
          relations: {
            spawns: [],
            groups: [{ id: "projected", kind, members: [], created_at: 1 }],
          },
        }),
      ).toThrow("Herdr");
      expect(store.get().revision).toBe(0);
    }
  });

  test("role conflicts are atomic and move only after explicit confirmation, preserving shared reviewers", () => {
    const store = new BoardStore(path);
    store.patch([
      {
        op: "group.create",
        id: "a",
        kind: "pod",
        name: "A",
        members: [member("agent://studio/peek", ["lead", "reviewer"])],
      },
      {
        op: "group.create",
        id: "b",
        kind: "pod",
        name: "B",
        members: [member("agent://studio/peek", ["reviewer"])],
      },
    ]);
    const before = store.get();
    expect(() =>
      store.patch([
        { op: "group.set_attrs", id: "a", name: "Must roll back" },
        {
          op: "group.set_roles",
          id: "b",
          refs: ["agent://studio/peek"],
          roles: ["builder", "reviewer"],
        },
      ]),
    ).toThrow("confirm an explicit transfer");
    expect(store.get()).toEqual(before);
    expect(new BoardStore(path).get()).toEqual(before);
    store.patch([
      {
        op: "group.set_roles",
        id: "b",
        refs: ["agent://studio/peek"],
        roles: ["builder", "reviewer"],
        replace: true,
      },
    ]);
    expect(
      store.get().relations.groups.map((group) => group.members[0]!.roles),
    ).toEqual([["reviewer"], ["builder", "reviewer"]]);
    const events = store.get().relations.group_changes!.slice(-2);
    expect(events.map((event) => [event.group_id, event.revision])).toEqual([
      ["a", 2],
      ["b", 2],
    ]);
    expect(events[0]!.members[0]).toEqual({
      ref: "agent://studio/peek",
      before: ["lead", "reviewer"],
      after: ["reviewer"],
    });
  });

  test("explicit promotion preserves identity and records all 64 member changes at the bound", () => {
    const store = new BoardStore(path, { now: () => 7 });
    const members = Array.from({ length: 32 }, (_, i) => ({
      ref: terminal(`t${i}`),
      roles: [],
    }));
    store.patch([
      { op: "group.create", id: "same", kind: "team", name: "Team", members },
    ]);
    const before = store.get();
    const mapping = members.map(({ ref }, i) => ({
      from: ref,
      to: `agent://studio/agent-${i}`,
      roles: ["reviewer"],
    }));
    expect(() =>
      store.patch([
        {
          op: "group.promote",
          id: "same",
          name: "Pod",
          mapping: mapping.slice(1),
        },
      ]),
    ).toThrow("complete");
    expect(() =>
      store.patch([
        {
          op: "group.promote",
          id: "same",
          name: "Pod",
          mapping: mapping.map((entry, i) => (i === 1 ? mapping[0]! : entry)),
        },
      ]),
    ).toThrow("ambiguous");
    expect(store.get()).toEqual(before);
    store.patch([{ op: "group.promote", id: "same", name: "Pod", mapping }]);
    expect(store.get().relations.groups[0]).toMatchObject({
      id: "same",
      kind: "pod",
      created_at: 7,
      name: "Pod",
    });
    expect(store.get().relations.group_changes!.at(-1)!.members).toHaveLength(
      64,
    );
    expect(new BoardStore(path).get()).toEqual(store.get());
  });

  test("retains only recent attribution, suppresses no-op events and never invents a sender", () => {
    const store = new BoardStore(path);
    store.patch([{ op: "group.create", id: "pod", kind: "pod", name: "A" }]);
    for (let i = 0; i < 135; i++)
      store.patch([{ op: "group.set_attrs", id: "pod", name: `Pod ${i}` }]);
    const changes = store.get().relations.group_changes!;
    expect(changes).toHaveLength(128);
    expect(
      changes.every(
        (event) =>
          event.sender.basis === "unknown" && !("label" in event.sender),
      ),
    ).toBe(true);
    store.patch([{ op: "group.set_attrs", id: "pod", name: "Pod 134" }]);
    expect(store.get().relations.group_changes).toEqual(changes);
    expect(new BoardStore(path).get().relations.group_changes).toEqual(changes);
  });

  test("enforces caps on the final state and refuses stale revisions without changing attribution", () => {
    const store = new BoardStore(path);
    const members = Array.from({ length: 32 }, (_, i) =>
      member(`agent://studio/agent-${i}`),
    );
    store.patch([
      { op: "group.create", id: "full", kind: "pod", name: "Full", members },
    ]);
    const before = store.get();
    expect(() =>
      store.patch([
        { op: "group.join", id: "full", refs: ["agent://studio/overflow"] },
      ]),
    ).toThrow("32");
    expect(store.patchIf(0, [{ op: "group.delete", id: "full" }])).toBeNull();
    expect(store.get()).toEqual(before);
    const roles = Array.from({ length: 16 }, (_, i) => `role-${i}`);
    store.patch([
      {
        op: "group.set_roles",
        id: "full",
        refs: ["agent://studio/agent-0"],
        roles,
      },
    ]);
    const capped = store.get();
    expect(() =>
      store.patch([
        {
          op: "group.join",
          id: "full",
          refs: ["agent://studio/agent-0"],
          roles: ["extra"],
        },
      ]),
    ).toThrow("roles");
    expect(store.get()).toEqual(capped);
    const perConnection = new BoardStore(join(root, "cap.json"));
    perConnection.patch(
      Array.from({ length: 32 }, (_, i) => ({
        op: "group.create" as const,
        id: `p${i}`,
        kind: "pod",
        name: `Pod ${i}`,
        members: [member("agent://studio/reviewer", ["reviewer"])],
      })),
    );
    expect(() =>
      perConnection.patch([
        {
          op: "group.create",
          id: "overflow",
          kind: "pod",
          name: "Overflow",
          members: [member("agent://studio/reviewer", ["reviewer"])],
        },
      ]),
    ).toThrow("pods per connection");
  });

  test("join and promotion cannot silently displace another pod's lead", () => {
    for (const action of ["join", "promote"] as const) {
      const store = new BoardStore(join(root, `${action}.json`));
      store.patch([
        {
          op: "group.create",
          id: "a",
          kind: "pod",
          name: "A",
          members: [member("agent://studio/peek", ["lead", "reviewer"])],
        },
        {
          op: "group.create",
          id: "b",
          kind: action === "join" ? "pod" : "team",
          name: "B",
          members:
            action === "join" ? [] : [{ ref: terminal("old"), roles: [] }],
        },
      ]);
      const before = store.get();
      const op =
        action === "join"
          ? {
              op: "group.join" as const,
              id: "b",
              refs: ["agent://studio/peek"],
              roles: ["builder"],
            }
          : {
              op: "group.promote" as const,
              id: "b",
              name: "B",
              mapping: [
                {
                  from: terminal("old"),
                  to: "agent://studio/peek",
                  roles: ["builder"],
                },
              ],
            };
      expect(() => store.patch([op])).toThrow("confirm an explicit transfer");
      expect(store.get()).toEqual(before);
      store.patch([{ ...op, replace: true }]);
      expect(store.get().relations.groups[0]!.members[0]!.roles).toEqual([
        "reviewer",
      ]);
    }
  });

  test("refuses projected-kind setters and malformed attribution, while a sender name grants no authority", () => {
    const store = new BoardStore(path);
    store.patch([
      {
        op: "group.create",
        id: "pod",
        kind: "pod",
        name: "A",
        members: [member("agent://studio/agent")],
        sender: { label: "ordinary agent", basis: "reported" },
      },
    ]);
    for (const kind of ["room", "desk", " Room "]) {
      expect(() =>
        store.patch([{ op: "group.set_attrs", id: "pod", kind } as never]),
      ).toThrow("Herdr");
    }
    expect(() =>
      store.patch([
        {
          op: "group.set_roles",
          id: "pod",
          refs: ["agent://studio/agent"],
          roles: ["reviewer"],
          sender: { label: "owner", basis: "observed" },
        } as never,
      ]),
    ).toThrow("basis");
    store.patch([
      {
        op: "group.set_roles",
        id: "pod",
        refs: ["agent://studio/agent"],
        roles: ["lead"],
        sender: { label: "ordinary agent", basis: "reported" },
      },
    ]);
    expect(store.get().relations.group_changes!.at(-1)!.sender).toEqual({
      label: "ordinary agent",
      basis: "reported",
    });
  });
});
