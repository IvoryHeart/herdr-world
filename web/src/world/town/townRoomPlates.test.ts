import { expect, test } from "bun:test";
import { checkTownRoomPlates } from "./townRoomPlates.browser";

test("plate checks wait for a committed overview card without another renderer frame", async () => {
  const renderer = { frames: 1, flying: false, level: "overview", zoom: 1 };
  let mounted = false;
  let clicked = false;
  // Stop at activation: the browser suite owns the subsequent real plate checks.
  const activated = new Error("committed room card activated");
  const card = {
    click() {
      clicked = true;
      throw activated;
    },
  };
  const host = {
    querySelector(selector: string) {
      expect(selector).toBe(".town-room-card");
      return mounted ? card : null;
    },
  } as unknown as HTMLElement;
  const waitFor = async (condition: () => boolean) => {
    if (condition()) return;
    expect(clicked).toBe(false);
    // React's visibility commit can follow renderer readiness without a frame.
    mounted = true;
    expect(condition()).toBe(true);
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { __HERDR_TOWN_RENDERER__: renderer },
  });
  try {
    await expect(
      checkTownRoomPlates(host, () => {}, waitFor, {
        connectionId: "synthetic-a",
        generation: 1,
        workspaceId: "synthetic-room",
      }),
    ).rejects.toBe(activated);
    expect(mounted).toBe(true);
    expect(clicked).toBe(true);
    expect(renderer.frames).toBe(1);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
