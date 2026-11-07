import { expect, test } from "bun:test";
import type { OfficeAgent } from "../herdrOfficeProjection";
import { townCenterActions } from "./useTownCenter";

const agent = (key: string, agentName: string, extra = {}) =>
  ({
    key,
    agentName,
    displayLabel: agentName,
    stale: false,
    canOpenInSpaces: true,
    ...extra,
  }) as OfficeAgent;

function center(
  options: {
    holder?: { connection_id: string; terminal_id: string } | null;
    name?: string;
    selectedRoomKey?: string | null;
    roomReason?: string | null;
    seat?: boolean;
    roster?: OfficeAgent[];
  } = {},
) {
  const calls: unknown[][] = [];
  const roster = (
    options.roster ?? [agent("leaf-1", "firstmate"), agent("leaf-2", "lead")]
  ).map((entry) => ({ agent: entry }));
  const actions = townCenterActions({
    world: {
      leaves: [
        { id: "leaf-2", connectionId: "local", terminalId: "t-2" },
      ] as never,
    },
    office: {
      rooms: [{ key: "room-a", displayLabel: "api" }] as never,
      roster: roster as never,
    },
    holder: options.holder ?? null,
    name: options.name ?? "firstmate",
    selectedRoomKey: options.selectedRoomKey ?? null,
    rooms: {
      canCreateSeat: () => options.seat ?? true,
      onNewAgent: (key) => calls.push(["launch", key]),
      canCreateRoom: () => !options.roomReason,
      createRoomReason: () => options.roomReason ?? null,
      onCreateRoom: (key) => calls.push(["room", key]),
    },
    summary: {
      summary: { counts: { needsYou: 3 } },
      open: () => calls.push(["summary"]),
    },
    openChat: (key) => calls.push(["chat", key]),
    toast: (kind, text) => calls.push(["toast", kind, text]),
  });
  const action = (id: string) => actions.find((entry) => entry.id === id)!;
  return { actions, action, calls };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the ring offers a new agent first, then the Town master and the town's errands", () => {
  const { actions, action } = center();
  expect(actions.map((entry) => entry.id)).toEqual([
    "launch",
    "master",
    "needs-you",
    "summary",
    "profiles",
    "room",
  ]);
  expect(action("launch").primary).toBe(true);
  expect(action("needs-you").count).toBe(3);
  expect(action("master").detail).toBe("firstmate");
});

test("a new agent starts in the open room when it can take one", () => {
  const open = center({ selectedRoomKey: "room-a" });
  expect(open.action("launch").detail).toBe("in api");
  open.action("launch").run();
  expect(open.calls).toEqual([["launch", "room-a"]]);
  // A room that cannot take a seat leaves the choice to the launcher.
  expect(
    center({ selectedRoomKey: "room-a", seat: false }).action("launch").detail,
  ).toBeUndefined();
});

test("Town master opens the role holder's chat first, then the named agent", async () => {
  const named = center();
  named.action("master").run();
  await settle();
  expect(named.calls).toEqual([["chat", "leaf-1"]]);

  const holder = center({
    holder: { connection_id: "local", terminal_id: "t-2" },
  });
  expect(holder.action("master").detail).toBeUndefined();
  holder.action("master").run();
  await settle();
  expect(holder.calls).toEqual([["chat", "leaf-2"]]);
});

test("a Town master missing from Town, or unopenable, says so instead", async () => {
  const missing = center({ name: "nobody" });
  missing.action("master").run();
  await settle();
  expect(missing.calls).toEqual([
    ["toast", "error", "No Town master in Town named nobody"],
  ]);

  const stale = center({
    roster: [agent("leaf-1", "firstmate", { stale: true })],
  });
  stale.action("master").run();
  await settle();
  expect(stale.calls).toEqual([
    ["toast", "error", "firstmate can't be opened now"],
  ]);
});

test("with no Town master set, the action offers to choose one", () => {
  expect(center({ name: "" }).action("master").detail).toBe("Choose one");
});

test("New room is shown disabled with the reason it cannot be created", () => {
  const blocked = center({ roomReason: "Host is reconnecting" });
  expect(blocked.action("room").disabled).toBe(true);
  expect(blocked.action("room").detail).toBe("Host is reconnecting");
  const open = center({ selectedRoomKey: "room-a" });
  expect(open.action("room").disabled).toBe(false);
  open.action("room").run();
  open.action("summary").run();
  expect(open.calls).toEqual([["room", "room-a"], ["summary"]]);
});
