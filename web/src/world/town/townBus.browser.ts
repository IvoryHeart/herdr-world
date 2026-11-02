import { BIN_DEPARTURE_MS } from "../../../../shared/bin";
import type { createFakeBin } from "../testing/fakeBin";
import { BUS_W } from "./townBusGeometry";
import { townBusSender } from "./useTownBus";

/**
 * Town's bus against the real scene and a fixture bin service: an agent sent
 * to the stop goes in qualified, leaves its desk and rides; holding the bus
 * pauses every countdown; Resume resumes; once the countdown is over the
 * bus drives away and can still be held, or its rider taken off, until it
 * leaves the map. Nothing here can close anything: the fixture's bin never
 * does.
 */
export async function checkTownBus(
  host: HTMLElement,
  check: (condition: boolean, message: string) => void,
  waitFor: (
    condition: () => boolean,
    message: string | (() => string),
    timeoutMs?: number,
  ) => Promise<void>,
  bin: ReturnType<typeof createFakeBin>,
) {
  const agent = host.querySelector<HTMLElement>(
    '.world-semantic-target[data-kind="agent"]',
  );
  const key = agent?.dataset.targetKey;
  check(Boolean(key), "the town shows no agent to send");
  check(Boolean(townBusSender.send), "Town registered no way to the bus stop");
  if (!key || !townBusSender.send) return;
  const atDesk = () =>
    host.querySelector(
      `.world-semantic-target[data-target-key="${CSS.escape(key)}"]`,
    ) !== null;

  check(
    (await townBusSender.send(key)) === "moved",
    "sending an agent to the stop did not stage it",
  );
  const add = bin.calls.find((call) => call.method === "world.bin.add");
  check(
    Boolean(
      add &&
        typeof add.params.connection_id === "string" &&
        Number.isSafeInteger(add.params.connection_generation) &&
        ["workspace_id", "tab_id", "pane_id", "terminal_id"].every(
          (field) => typeof add.params[field] === "string" && add.params[field],
        ) &&
        add.params.view === "town",
    ),
    `the bin add was not qualified: ${JSON.stringify(add?.params)}`,
  );
  await waitFor(() => !atDesk(), "the rider stayed at its desk");
  await waitFor(
    () => host.querySelectorAll(".town-bus-rider").length === 1,
    "the rider has no place at the stop or on the bus",
  );
  check(
    /· 1/.test(host.querySelector(".town-bus-sign")?.textContent ?? ""),
    "the stop's sign does not count the rider",
  );

  // The bus pulls in, then waits with its doors open. Hold it from the
  // keyboard: Enter or Space is a click with no pointer.
  await waitFor(
    () => host.querySelector(".town-bus-hold") !== null,
    "the bus never stood at the stop",
    8_000,
  );
  // Real presses land on whatever is on top: when the stop is hidden (under
  // the asks rail, the zoom column or off screen) its chip opens the common
  // tray and flies there; shutting the tray resumes, and then the bus must
  // be the topmost thing under the finger.
  const onTop = (element: Element, x: number, y: number) =>
    element.contains(document.elementFromPoint(x, y));
  const pausesAll = () =>
    bin.calls.filter((call) => call.method === "world.bin.pause").length;
  const resumesAll = () =>
    bin.calls.filter((call) => call.method === "world.bin.resume").length;
  const chip = host.querySelector<HTMLButtonElement>(".town-bus-chip");
  if (chip) {
    chip.click();
    await waitFor(
      () => host.querySelector(".town-bus-held") !== null,
      "the stop's chip did not open the bin tray",
      4_000,
    );
    host.querySelector<HTMLButtonElement>(".world-bin-resume")!.click();
    await waitFor(
      () =>
        host.querySelector(".town-bus-chip") === null &&
        host.querySelector(".town-bus-held") === null,
      "flying to the stop left it hidden",
      4_000,
    );
  }
  // The stop itself, finger-sized at any zoom, opens the same tray.
  const stop = host.querySelector<HTMLButtonElement>(".town-bus-stop");
  check(stop !== null, "the bus stop is not a button");
  if (stop) {
    const at = stop.getBoundingClientRect();
    check(
      at.width >= 43 && at.height >= 43,
      "the bus stop is smaller than a finger",
    );
    const opened = pausesAll();
    stop.click();
    await waitFor(
      () =>
        pausesAll() === opened + 1 &&
        host.querySelector(".town-bus-held") !== null,
      "tapping the bus stop did not open the bin tray",
    );
    host.querySelector<HTMLButtonElement>(".world-bin-resume")!.click();
    await waitFor(
      () => host.querySelector(".town-bus-held") === null,
      "the tray opened from the stop did not shut",
    );
  }
  // Counted from here: the chip's own tray open and shut came before.
  const paused0 = pausesAll(),
    resumed0 = resumesAll();
  const pauses = () => pausesAll() - paused0;
  const resumes = () => resumesAll() - resumed0;
  // Staged at 0:30, the bus is still driving in (due at the stop at 0:10),
  // and is already held along its road.
  check(
    host.querySelector('.town-bus-hold[data-coming="true"]') !== null,
    "the bus driving in to the stop cannot be held",
  );
  // Where it stands at the stop: the stop end of its road while it comes.
  const holdTarget = host.querySelector<HTMLElement>(".town-bus-hold")!;
  const holdAt = holdTarget.getBoundingClientRect();
  const holdScale = holdAt.width / holdTarget.offsetWidth;
  check(
    onTop(
      holdTarget,
      holdAt.right - (BUS_W / 2) * holdScale,
      holdAt.bottom - 4 * holdScale,
    ),
    "the waiting bus is covered where a finger would hold it",
  );
  host.querySelector<HTMLButtonElement>(".town-bus-hold")!.click();
  await waitFor(() => pauses() === 1, "Enter on the bus did not hold it");

  // Held: its controls are in screen space, inside the viewport and on top
  // of whatever the town shows there (the asks rail included).
  await waitFor(
    () => host.querySelector(".town-bus-held") !== null,
    "a held bus shows no controls",
  );
  const reachable = (button: HTMLElement) => {
    const box = button.getBoundingClientRect();
    const x = box.left + box.width / 2,
      y = box.top + box.height / 2;
    return (
      box.width > 0 &&
      box.top >= 0 &&
      box.left >= 0 &&
      box.bottom <= window.innerHeight &&
      box.right <= window.innerWidth &&
      button.contains(document.elementFromPoint(x, y))
    );
  };
  const go = host.querySelector<HTMLButtonElement>(
    ".town-bus-held .world-bin-resume",
  )!;
  const back = host.querySelector<HTMLButtonElement>(
    ".town-bus-held li button",
  )!;
  check(reachable(go), "Resume is covered or off screen");
  check(reachable(back), "Put back on the held bus is covered or off screen");
  go.click();
  await waitFor(() => resumes() === 1, "Resume did not resume the bin");
  await waitFor(
    () => host.querySelector(".town-bus-held") === null,
    "the held controls stayed after Resume",
  );

  // A plain pointer tap opens the same held tray; no hold timer is needed.
  host
    .querySelector<HTMLElement>(".town-bus-hold")!
    .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  host
    .querySelector<HTMLElement>(".town-bus-hold")!
    .dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  host
    .querySelector(".town-bus-hold")!
    .dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  await waitFor(() => pauses() === 2, "plain bus tap did not open held tray");
  await waitFor(
    () => host.querySelector(".town-bus-held .world-bin-resume") !== null,
    "a held bus offers no Resume",
  );
  // Resume with the countdown over: the bus drives away.
  for (const entry of bin.state.entries)
    entry.remaining_ms = BIN_DEPARTURE_MS - 300;
  host
    .querySelector<HTMLButtonElement>(".town-bus-held .world-bin-resume")!
    .click();
  await waitFor(() => resumes() === 2, "Resume did not resume the bin");
  const road = () =>
    host.querySelector<HTMLElement>('.town-bus-hold[data-leaving="true"]');
  await waitFor(() => road() !== null, "the bus did not drive away");
  check(
    /leaving/.test(host.querySelector(".town-bus-sign")?.textContent ?? ""),
    "the stop's sign does not say the bus is leaving",
  );

  // A plain tap on the moving bus opens the shared tray and stops it there.
  const at = (strip: HTMLElement, x: number, y: number) => {
    const box = strip.getBoundingClientRect();
    const scale = box.width / strip.offsetWidth;
    return { clientX: box.left + x * scale, clientY: box.top + y * scale };
  };
  {
    const wheels = at(road()!, 31, 38);
    check(
      onTop(road()!, wheels.clientX, wheels.clientY),
      "the bus driving away is covered where a finger would hold it",
    );
  }
  road()!.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, ...at(road()!, 4, 38) }),
  );
  road()!.dispatchEvent(
    new PointerEvent("pointerup", { bubbles: true, ...at(road()!, 4, 38) }),
  );
  road()!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  await waitFor(() => pauses() === 3, "holding the moving bus did not stop it");
  await waitFor(
    () =>
      /departure held/.test(
        host.querySelector(".town-bus-held")?.textContent ?? "",
      ),
    "the held panel does not say the bus was stopped departure held",
  );
  check(road() === null, "a held bus still drives away");
  host
    .querySelector<HTMLButtonElement>(".town-bus-held .world-bin-resume")!
    .click();
  await waitFor(() => resumes() === 3, "Resume did not resume the bin");
  await waitFor(() => road() !== null, "the bus did not drive on");

  // Take the rider off the moving bus: press along its upper windows, as
  // drawn in this frame, until one lands on the rider.
  const strip = road()!;
  for (let x = 0; x < strip.offsetWidth; x += 2) {
    const point = at(strip, x, 10);
    strip.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, ...point }),
    );
    const moved = { clientX: point.clientX + 32, clientY: point.clientY + 32 };
    strip.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, ...moved }),
    );
    strip.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, ...moved }),
    );
    if (bin.calls.some((call) => call.method === "world.bin.restore")) break;
  }
  await waitFor(
    () => bin.calls.some((call) => call.method === "world.bin.restore"),
    "taking the rider off the moving bus did not put it back",
  );
  check(pauses() === 3, "pressing the moving bus's road held it");
  await waitFor(atDesk, "the rider did not return to its desk");
  // Boarding: a second agent joins the first one's bus, and the countdown
  // starts again in full for both (the service's rule, mirrored here).
  await waitFor(atDesk, "the rider did not return to its desk");
  const others = [
    ...host.querySelectorAll<HTMLElement>(
      '.world-semantic-target[data-kind="agent"]',
    ),
  ]
    .map((target) => target.dataset.targetKey)
    .filter((other): other is string => Boolean(other) && other !== key);
  if (others[0]) {
    await townBusSender.send(key);
    await waitFor(() => bin.state.entries.length === 1, "no one is waiting");
    bin.state.entries[0]!.remaining_ms = 12_000 + BIN_DEPARTURE_MS;
    check(
      (await townBusSender.send(others[0])) === "moved",
      "a second agent could not board",
    );
    const [first, second] = bin.state.entries;
    check(
      first?.trip === second?.trip &&
        [first, second].every(
          (entry) => entry?.remaining_ms === 30_000 + BIN_DEPARTURE_MS,
        ),
      `boarding did not restart the countdown for the bus: ${JSON.stringify(bin.state.entries.map((e) => [e.trip, e.remaining_ms]))}`,
    );
    for (const _ of [0, 1]) {
      await waitFor(
        () => host.querySelector(".town-bus-rider") !== null,
        "a waiting rider has no button",
      );
      const rider = host.querySelector<HTMLButtonElement>(".town-bus-rider")!;
      const r = rider.getBoundingClientRect();
      rider.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: r.x,
          clientY: r.y,
        }),
      );
      rider.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: r.x + 32,
          clientY: r.y + 32,
        }),
      );
      rider.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: r.x + 32,
          clientY: r.y + 32,
        }),
      );
      await waitFor(
        () => bin.state.entries.length === (_ === 0 ? 1 : 0),
        "a rider was not put back",
      );
    }
  }
  check(
    !bin.calls.some((call) => call.method === "world.bin.close_now"),
    "the bus closed something",
  );
}
