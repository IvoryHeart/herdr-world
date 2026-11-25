import { expect, test } from "bun:test";
import { townMoveMenu, type TownMoveMenuDeps } from "./townMoveMenu";

const ref = (nativeId: string) => ({ connectionId: "studio", nativeId });
const DESK = {
  key: "d0",
  hostKey: "machine",
  roomKey: "home",
  displayLabel: "d0",
  tabRef: ref("d0"),
  paneDevices: [{}],
  canOpenInSpaces: true,
};
const room = (
  key: string,
  displayLabel: string,
  runtime?: ["herdr" | "herdr-core", string],
) => ({
  key,
  hostKey: "machine",
  displayLabel,
  observedDeskCount: 2,
  desks: key === "home" ? [DESK] : [],
  omittedDeskCount: 0,
  workspaceRef: ref(key),
  canOpenInSpaces: true,
  ...(runtime && { runtimeKind: runtime[0], runtimeTag: runtime[1] }),
});
// One building, two runtimes: two rooms named api, one web.
const ROOMS = [
  room("home", "home", ["herdr", "Herdr TUI"]),
  room("tui-api", "api", ["herdr", "Herdr TUI"]),
  room("core-api", "api", ["herdr-core", "herdr-core"]),
  room("core-web", "web", ["herdr-core", "herdr-core"]),
];

test("a move menu shows each room's runtime icon, and its words only where two rooms read the same (#1255)", () => {
  const deps = {
    office: { rooms: ROOMS, deskRoster: [{ desk: DESK }] },
    deskForKey: () => DESK,
    roomForKey: (key: string | null) =>
      ROOMS.find((each) => each.key === key) ?? null,
    agentOf: () => undefined,
    pinnedSeats: () => [],
    close: () => {},
    runDeskReorder: async () => {},
    runDeskMove: async () => "moved" as const,
    runAgentMove: async () => {},
    teams: { teamEntries: () => [] },
  } as unknown as TownMoveMenuDeps;
  const menu = townMoveMenu({ step: "room", deskKey: "d0" }, deps);
  expect(
    menu.entries.map(({ label, detail, runtime }) => [
      label,
      detail,
      runtime?.kind,
    ]),
  ).toEqual([
    ["api", "2 desks · Herdr TUI", "herdr"],
    ["api", "2 desks · herdr-core", "herdr-core"],
    ["web", "2 desks", "herdr-core"],
  ]);
});
