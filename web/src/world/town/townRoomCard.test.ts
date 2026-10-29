import { expect, test } from "bun:test";
import { prepareTownRoomCard } from "./townRoomCard.browser";
import type { TownRendererDiagnostics } from "./townDiagnostics";

type Camera = Pick<
  TownRendererDiagnostics,
  "frames" | "flying" | "level" | "zoom"
>;
function scenario(level: Camera["level"], flying = false) {
  const camera: Camera = { frames: 10, flying, level, zoom: 1.5 };
  let pending = flying ? 2 : 0;
  let mounted = level === "overview";
  let clicks = 0;
  const zoomOut = {
    click() {
      expect(camera.flying).toBe(false);
      clicks += 1;
      camera.flying = true;
      pending = 2;
    },
  };
  const host = {
    querySelector(selector: string) {
      return selector === ".town-room-card" ? (mounted ? {} : null) : zoomOut;
    },
  } as Pick<HTMLElement, "querySelector">;
  const waitFor = async (
    condition: () => boolean,
    message: string | (() => string),
  ) => {
    for (let tick = 0; tick < 8; tick += 1) {
      if (condition()) return;
      // A settled/calm renderer emits no unsolicited frames. Only an existing
      // flight or a real control action starts work; DOM mounting may lag it.
      if (pending && --pending === 0) {
        camera.frames += 1;
        camera.flying = false;
        camera.level = camera.level === "desk" ? "room" : "overview";
      } else if (!pending && camera.level === "overview") mounted = true;
    }
    throw new Error(typeof message === "string" ? message : message());
  };
  return { camera, host, waitFor, clicks: () => clicks };
}

test("a settled overview with no ambient frames needs no extra frame or zoom", async () => {
  const view = scenario("overview");
  await prepareTownRoomCard(view.host, view.camera, view.waitFor);
  expect(view.camera.frames).toBe(10);
  expect(view.clicks()).toBe(0);
});

test("settled desk entry progresses only through completed control-triggered flights", async () => {
  const view = scenario("desk");
  await prepareTownRoomCard(view.host, view.camera, view.waitFor);
  expect(view.camera.frames).toBe(12);
  expect(view.clicks()).toBe(2);
  expect(view.camera.level).toBe("overview");
  expect(view.host.querySelector(".town-room-card")).not.toBeNull();
});

test("an existing flight settles before zooming and card mounting can follow its last frame", async () => {
  const view = scenario("desk", true);
  await prepareTownRoomCard(view.host, view.camera, view.waitFor);
  expect(view.camera.frames).toBe(12);
  expect(view.clicks()).toBe(1);
  expect(view.camera.flying).toBe(false);
  expect(view.host.querySelector(".town-room-card")).not.toBeNull();
});
