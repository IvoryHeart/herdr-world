import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { store } from "../../store";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import type { WorldObject } from "../worldObject";
import { useTownRoomActions } from "./useTownRoomActions";

/** Town's New room with no room selected, over these hosts. */
function newRoom(hosts: Array<Partial<WorldObject["hosts"][number]>>) {
  let actions: ReturnType<typeof useTownRoomActions> | null = null;
  function Probe() {
    actions = useTownRoomActions({
      world: { hosts } as unknown as WorldObject,
      office: { rooms: [] } as unknown as HerdrOfficeProjection,
      creationSnapshot: store.get(),
      creationProgress: {} as Parameters<
        typeof useTownRoomActions
      >[0]["creationProgress"],
      roomDialog: null,
      setRoomDialog: () => {},
      beforeLaunch: () => {},
    });
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return {
    enabled: actions!.roomActions.canCreateRoom(null),
    reason: actions!.roomActions.createRoomReason(null),
  };
}

test("New room from the town center can choose a live herdr-core host", () => {
  expect(
    newRoom([
      {
        connectionId: "core-synthetic",
        generation: 1,
        actionable: false,
        stale: false,
        coreControl: true,
        viewOnly: "World can't mark core work reviewed yet",
      },
    ]),
  ).toEqual({ enabled: true, reason: null });
});

test("a stale herdr-core host and no Herdr host leave New room unavailable", () => {
  expect(
    newRoom([
      {
        connectionId: "core-synthetic",
        generation: 1,
        actionable: false,
        stale: true,
        coreControl: true,
      },
    ]).enabled,
  ).toBe(false);
});
