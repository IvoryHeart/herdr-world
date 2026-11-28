import { afterAll, expect, spyOn, test } from "bun:test";
import { bridge, type ConnectionStatus } from "../api";
import {
  saveTownReceptionFilter,
  TOWN_RECEPTION_SETTING_KEY,
  townReceptionFilter,
} from "../world/town/townReceptionSetting";
import { followPublishedUiSettings, installUiSettings } from "./uiSettings";

type Published = { ui: Record<string, unknown>; revision: number };

let onStatus: (status: ConnectionStatus) => void = () => {};
/** Answers a delayed save with its commit revision. */
const acks: Array<(revision: number) => void> = [];
const spies = [
  spyOn(bridge, "onHello").mockImplementation(() => () => true),
  spyOn(bridge, "onStatus").mockImplementation((callback) => {
    onStatus = callback;
    return () => true;
  }),
  spyOn(bridge, "call").mockImplementation((async (
    method: string,
    params?: Record<string, unknown>,
  ) => {
    if (method === "bridge.ui_settings.get") return { ui: {}, revision: 0 };
    // Every save waits until the test answers it with its commit revision.
    const revision = await new Promise<number>((resolve) => acks.push(resolve));
    return { key: params?.key, value: params?.value, revision };
  }) as typeof bridge.call),
];
afterAll(() => {
  for (const spy of spies) spy.mockRestore();
});

/** The shared browser replica, reduced to its published settings. */
function replica() {
  let current: Published | undefined;
  const listeners = new Set<() => void>();
  return {
    get: () => ({ uiSettings: current }),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(next: Published) {
      current = next;
      for (const listener of listeners) listener();
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const BLOCKED = { default: ["blocked" as const], hosts: {} };
const ASK = { default: ["ask" as const], hosts: {} };
const marks = () => townReceptionFilter().default.join();

test("a newer publication skipped during this browser's save is applied when the save ends", async () => {
  installUiSettings();
  onStatus("connected");
  await settle();
  const world = replica();
  followPublishedUiSettings(world);
  world.publish({ ui: {}, revision: 0 });

  // This browser saves "blocked" (commit 1); its answer is delayed.
  const saving = saveTownReceptionFilter(BLOCKED);
  await settle();
  expect(marks()).toBe("blocked");
  // Another browser's later commit (2) is published first.
  world.publish({ ui: { [TOWN_RECEPTION_SETTING_KEY]: ASK }, revision: 2 });
  expect(marks()).toBe("blocked");
  acks.shift()!(1);
  await saving;
  expect(marks()).toBe("ask");
  // An unchanged publication keeps it.
  world.publish({ ui: { [TOWN_RECEPTION_SETTING_KEY]: ASK }, revision: 2 });
  expect(marks()).toBe("ask");

  // A save (commit 3), then another browser restores the value shown before
  // it (commit 4): the restored value is applied, not suppressed as the
  // value this browser last adopted.
  const again = saveTownReceptionFilter(BLOCKED);
  await settle();
  acks.shift()!(3);
  await again;
  expect(marks()).toBe("blocked");
  // The browser next reads commit 4, never commit 3.
  world.publish({ ui: { [TOWN_RECEPTION_SETTING_KEY]: ASK }, revision: 4 });
  expect(marks()).toBe("ask");
});
