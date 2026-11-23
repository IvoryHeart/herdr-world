import { expect, test } from "bun:test";
import type { OfficeAgent } from "../herdrOfficeProjection";
import { openFocus } from "../focus";
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
    selectedRoomKey?: string | null;
    roomReason?: string | null;
    seat?: boolean;
    roster?: OfficeAgent[];
    focusing?: boolean;
    harness?: string;
  } = {},
) {
  const calls: unknown[][] = [];
  const roster = (
    options.roster ?? [agent("leaf-1", "firstmate"), agent("leaf-2", "lead")]
  ).map((entry) => ({ agent: entry }));
  const actions = townCenterActions({
    world: {
      leaves: [
        { id: "leaf-1", connectionId: "local", terminalId: "t-1" },
        {
          id: "leaf-2",
          connectionId: "local",
          terminalId: "t-2",
          kind: "agent",
          pane: { agent: options.harness ?? "codex" },
          actionable: true,
        },
      ] as never,
    },
    office: {
      rooms: [{ key: "room-a", displayLabel: "api" }] as never,
      roster: roster as never,
    },
    holder:
      options.holder === undefined
        ? { connection_id: "local", terminal_id: "t-1" }
        : options.holder,
    selectedRoomKey: options.selectedRoomKey ?? null,
    rooms: {
      canCreateSeat: () => options.seat ?? true,
      onNewAgent: (key, from) => calls.push(["launch", key, from]),
      canCreateRoom: () => !options.roomReason,
      createRoomReason: () => options.roomReason ?? null,
      onCreateRoom: (key) => calls.push(["room", key]),
    },
    summary: { open: () => calls.push(["summary"]) },
    openChat: (key) => calls.push(["chat", key]),
    toast: (kind, text) => calls.push(["toast", kind, text]),
    focusing: options.focusing ?? false,
  });
  const action = (id: string) => actions.find((entry) => entry.id === id)!;
  return { actions, action, calls };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the ring offers a new agent first, then the Town master and the town's errands", () => {
  const { actions, action } = center();
  // Places with a building (Needs you's post office, Apartments, the
  // Library) open from Buildings' second ring instead (#1261).
  expect(actions.map((entry) => entry.id)).toEqual([
    "launch",
    "master",
    "focus",
    "summary",
    "profiles",
    "room",
  ]);
  expect(action("launch").primary).toBe(true);
  expect(action("master").detail).toBeUndefined();
});

test("no first-ring entry carries a count or a number", () => {
  const { actions } = center({ focusing: true, selectedRoomKey: "room-a" });
  for (const action of actions) {
    expect(action.count).toBeUndefined();
    expect(`${action.label} ${action.detail ?? ""}`).not.toMatch(/\d/);
  }
});

test("Focus opens its chooser and says when a session runs, without its time", () => {
  expect(center().action("focus").detail).toBeUndefined();
  const focused = center({ focusing: true });
  expect(focused.action("focus").detail).toBe("On");
  expect(focused.action("focus").run).toBe(openFocus);
});

test("a new agent starts in the open room when it can take one", () => {
  const open = center({ selectedRoomKey: "room-a" });
  expect(open.action("launch").detail).toBe("in api");
  open.action("launch").run();
  expect(open.calls).toEqual([["launch", "room-a", "center"]]);
  // A room that cannot take a seat leaves the choice to the launcher.
  expect(
    center({ selectedRoomKey: "room-a", seat: false }).action("launch").detail,
  ).toBeUndefined();
});

test("Town master opens the role holder's chat with no name fallback", async () => {
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
  const missing = center({
    holder: { connection_id: "local", terminal_id: "t-absent" },
  });
  missing.action("master").run();
  await settle();
  expect(missing.calls).toEqual([
    ["toast", "error", "The Town master isn't in Town now"],
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

test("an assigned Town master absent from Town is unavailable, never a namesake", async () => {
  // The holder lives on another connection; a "firstmate" is in view here.
  const absent = center({
    holder: { connection_id: "host-a", terminal_id: "t-9" },
  });
  absent.action("master").run();
  await settle();
  expect(absent.calls).toEqual([
    ["toast", "error", "The Town master isn't in Town now"],
  ]);
});

test("with no Town master set, the action offers to choose one", () => {
  expect(center({ holder: null }).action("master").detail).toBe("Choose one");
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
