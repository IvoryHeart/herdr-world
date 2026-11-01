import { bridge } from "../../api";
import { worldBinStore } from "../bin/binStore";
import type { createFakeBin } from "../testing/fakeBin";
import { townBusSender } from "./useTownBus";
import { setTabPinned } from "../../tabPins";
import type { WorldLeafObject } from "../worldObject";

/** Held controls must leave the full 44px waiting / 52px carry chip usable. */
export async function checkHeldBusChip(
  host: HTMLElement,
  waitFor: (condition: () => boolean, message: string) => Promise<void>,
  check: (condition: boolean, message: string) => void,
) {
  const key = host.querySelector<HTMLElement>(
    '.world-semantic-target[data-kind="agent"]',
  )!.dataset.targetKey!;
  const store = worldBinStore(bridge);
  await townBusSender.send!(key);
  await store.pause();
  const canvas = host.querySelector<HTMLElement>(".town-canvas-host")!;
  for (let i = 0; i < 40; i++)
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
  const chip = () => host.querySelector<HTMLElement>(".town-bus-chip");
  await waitFor(
    () => !!chip() && !!host.querySelector(".town-bus-held"),
    "held bus chip did not appear after pan",
  );
  const probe = (size: number) => {
    const e = chip()!,
      r = e.getBoundingClientRect();
    check(
      r.height >= size &&
        r.left >= 0 &&
        r.top >= 0 &&
        r.right <= innerWidth &&
        r.bottom <= innerHeight,
      `held ${size}px chip must fit the viewport`,
    );
    const hits = [0.1, 0.5, 0.9].flatMap((x) =>
      [0.1, 0.5, 0.9].map((y) =>
        e.contains(
          document.elementFromPoint(r.left + r.width * x, r.top + r.height * y),
        ),
      ),
    );
    check(
      hits.every(Boolean),
      `held ${size}px chip must be topmost at all9points (got ${hits.filter(Boolean).length}/9)`,
    );
  };
  probe(44);
  // The fixture supplies the same carry-presence DOM port the real gesture
  // produces; this is geometry evidence, not a native drag/admission claim.
  const ghost = document.createElement("div");
  ghost.className = "town-drag-ghost";
  document.body.append(ghost);
  canvas.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  await waitFor(
    () => chip()?.dataset.carrying === "true",
    "carry chip did not draw",
  );
  probe(52);
  ghost.remove();
  canvas.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
  );
  await waitFor(
    () => chip()?.dataset.carrying === "false",
    "carry presence did not clear",
  );
  for (const entry of [...store.get().entries]) await store.restore(entry.id);
}

/** Actual Town peek admissions; expiry is a service event, never a second UI add. */
export async function checkTownClosingPin(
  host: HTMLElement,
  bin: ReturnType<typeof createFakeBin>,
  pair: WorldLeafObject[],
  waitFor: (condition: () => boolean, message: string) => Promise<void>,
  check: (condition: boolean, message: string) => void,
) {
  const [first, second] = pair;
  if (!first || !second) throw new Error("I1/R5: missing Town sibling fixture");
  const peek = async (leaf: WorldLeafObject) => {
    const selector = `.town-reception-entry[data-agent-key="${CSS.escape(leaf.id)}"]`;
    await waitFor(
      () => !!host.querySelector(selector),
      "I1/R5: Town sibling has no reception entry",
    );
    host
      .querySelector(selector)!
      .dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true, relatedTarget: null }),
      );
    await waitFor(
      () =>
        !!host.querySelector(
          `.town-peek[data-agent-key="${CSS.escape(leaf.id)}"]`,
        ),
      "I1/R5: Town sibling peek did not open",
    );
    const action = [
      ...host.querySelectorAll<HTMLButtonElement>(".town-peek button"),
    ].find((b) => b.textContent === "Send to the bus stop");
    if (!action)
      throw new Error("I1/R5: Town peek has no real bus admission control");
    action.click();
  };
  const store = worldBinStore(bridge);
  setTabPinned(first.connectionId, first.tabId, true);
  await peek(first);
  await waitFor(
    () => store.get().entries.length === 1,
    "I1/R5: actual Town peek did not stage first sibling",
  );
  check(
    store.get().entries[0]!.terminal_id === first.terminalId,
    "I1/R5: Town peek staged a different sibling",
  );
  host.querySelector<HTMLButtonElement>(".town-peek-close")?.click();
  bin.holdCloses = true;
  bin.call("world.bin.close_now", { ids: [store.get().entries[0]!.id] });
  await store.refresh();
  await waitFor(
    () => store.get().entries.length === 0 && store.get().closing.length === 1,
    "I1/R5: Town close did not enter held native phase",
  );
  const before = bin.calls.filter(
    (call) => call.method === "world.bin.add",
  ).length;
  await peek(second);
  await waitFor(
    () =>
      /last pane of a pinned tab/i.test(
        host.querySelector(".town-bus-toast")?.textContent ?? "",
      ),
    "I1/R5: Town did not refuse the remaining pinned pane",
  );
  check(
    bin.calls.filter((call) => call.method === "world.bin.add").length ===
      before,
    "I1/R5: Town admitted remaining pinned sibling after entries emptied",
  );
  host.querySelector<HTMLButtonElement>(".town-peek-close")?.click();
  setTabPinned(first.connectionId, first.tabId, false);
  bin.holdCloses = false;
  bin.state.closing = [];
  bin.state.reservations = [];
  bin.state.revision++;
  await store.refresh();
}

/** Reconstruct the real Town layer from service-shaped samples, without private trajectory maps. */
export async function checkTownBusRemount(
  host: HTMLElement,
  bin: ReturnType<typeof createFakeBin>,
  remount: () => Promise<void>,
  waitFor: (condition: () => boolean, message: string) => Promise<void>,
  check: (condition: boolean, message: string) => void,
) {
  const keys = [
    ...host.querySelectorAll<HTMLElement>(
      '.world-semantic-target[data-kind="agent"]',
    ),
  ].map((node) => node.dataset.targetKey!);
  check(keys.length >= 2, "I2: remount fixture needs two agents");
  if (keys.length < 2) return;
  const store = worldBinStore(bridge);
  await townBusSender.send!(keys[0]!);
  const first = bin.state.entries[0]!;
  Object.assign(first, {
    trip_duration_ms: 30_000,
    trip_elapsed_ms: 19_000,
    remaining_ms: 17_000,
  });
  bin.state.paused = true;
  bin.state.revision++;
  await store.refresh();
  await waitFor(
    () =>
      !!host.querySelector(
        '.town-bus-hold[data-phase="arriving"][data-trip-elapsed="19000"]',
      ),
    "I2: bus should still approach at original 19s",
  );
  const position = () =>
    Number.parseFloat(
      host.querySelector<HTMLElement>(".town-bus-hold")!.style.left,
    );
  const before = position();
  await townBusSender.send!(keys[1]!);
  await waitFor(
    () => store.get().entries.length === 2,
    "I2: boarding reset did not publish",
  );
  check(
    store.get().entries.every((e) => e.remaining_ms === 36_000),
    "I2: boarding must reset departure for both",
  );
  await remount();
  await waitFor(
    () => !!host.querySelector('.town-bus-hold[data-phase="arriving"]'),
    "I2: approaching bus lost on remount",
  );
  check(
    Math.abs(position() - before) < 0.01,
    `I2: remount rewound the reset bus trajectory (${before} → ${position()})`,
  );
  // An observer joining after a long hold sees the same active progress.
  await remount();
  await waitFor(
    () => !!host.querySelector(".town-bus-hold"),
    "I2: fresh observer has no held bus",
  );
  check(
    Math.abs(position() - before) < 0.01,
    "I2: fresh Town observer moved a held bus",
  );
  for (const entry of bin.state.entries)
    Object.assign(entry, { trip_elapsed_ms: 20_000, remaining_ms: 35_000 });
  bin.state.revision++;
  await store.refresh();
  await waitFor(
    () => !!host.querySelector('.town-bus-hold[data-phase="waiting"]'),
    "I2: bus did not arrive after one more active second",
  );
  const parked = position();
  // A later reset leaves the parked bus parked, including a full layer remount.
  for (const entry of bin.state.entries) entry.remaining_ms = 36_000;
  bin.state.revision++;
  await store.refresh();
  await remount();
  await waitFor(
    () => !!host.querySelector('.town-bus-hold[data-phase="waiting"]'),
    "I2: parked reset started approaching after remount",
  );
  check(
    Math.abs(position() - parked) < 0.01,
    "I2: parked reset changed the bus position",
  );
  for (const entry of [...store.get().entries]) await store.restore(entry.id);
}
