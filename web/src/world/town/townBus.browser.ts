import { BIN_DEPARTURE_MS } from "../../../../shared/bin";
import type { createFakeBin } from "../testing/fakeBin";
import { townBusSender } from "./useTownBus";

/**
 * Town's bus against the real scene and a fixture bin service: an agent sent
 * to the stop goes in qualified and leaves its desk; a tap on the chip, a stop
 * or the bus opens the common tray, which holds every countdown until
 * Resume; once the countdown is over the leaving bus can still be stopped;
 * Put back returns the rider; boarding restarts the shared countdown.
 * Nothing here can close anything: the fixture's bin never does.
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
  // Town's controls follow the bus layer's drawn frames: the rider's own
  // target (and the off-screen chip) appear on the first frame drawn after
  // the add, so every step below starts from that frame.
  const riderId = bin.state.entries[0]!.id;
  const riderTarget = () =>
    host.querySelector<HTMLButtonElement>(
      `.town-bus-rider[data-bin-entry="${CSS.escape(riderId)}"]`,
    );
  await waitFor(
    () => riderTarget() !== null,
    "the rider's place at the stop was never drawn",
  );
  check(
    /· 1/.test(host.querySelector(".town-bus-sign")?.textContent ?? ""),
    "the stop's sign does not count the rider",
  );
  const pausesAll = () =>
    bin.calls.filter((call) => call.method === "world.bin.pause").length;
  const resumesAll = () =>
    bin.calls.filter((call) => call.method === "world.bin.resume").length;
  const held = () => host.querySelector(".town-bus-held");
  const resume = async (message: string) => {
    const resumed = resumesAll();
    host.querySelector<HTMLButtonElement>(".world-bin-resume")!.click();
    await waitFor(() => resumesAll() === resumed + 1, message);
    await waitFor(() => held() === null, `${message}: the tray stayed open`);
  };
  /** A tap on `target` opens the common tray and holds the bin. */
  const opens = async (target: HTMLElement, message: string) => {
    const paused = pausesAll();
    target.click();
    await waitFor(
      () => pausesAll() === paused + 1 && held() !== null,
      message,
      4_000,
    );
  };
  // Off screen, the stop's chip opens the tray and brings the stop in view.
  // In this fixture the stop where the bus waits starts off screen at every
  // viewport, so the chip must be there.
  const chip = host.querySelector<HTMLButtonElement>(".town-bus-chip");
  check(chip !== null, "the off-screen stop has no chip");
  if (chip) {
    await opens(chip, "the stop's chip did not open the bin tray");
    await resume("Resume from the chip's tray did not resume the bin");
  }
  // Any stop, finger-sized at any zoom, opens the same tray.
  const stop = host.querySelector<HTMLButtonElement>(".town-bus-stop");
  check(stop !== null, "the bus stop is not a button");
  if (stop) {
    const at = stop.getBoundingClientRect();
    check(
      at.width >= 43 && at.height >= 43,
      "the bus stop is smaller than a finger",
    );
    await opens(stop, "tapping the bus stop did not open the bin tray");
    await resume("Resume from the stop's tray did not resume the bin");
  }
  // A waiting rider is its own target, beside the stop's, opening the
  // same tray.
  const waiting = riderTarget();
  check(waiting !== null, "a waiting rider is not a button");
  if (waiting) {
    await opens(waiting, "tapping a waiting rider did not open the bin tray");
    // Held, the rider's own label shows the same wait as the stop's sign.
    const signWait = /^\S+/.exec(
      host.querySelector(".town-bus-sign")?.textContent ?? "",
    )?.[0];
    const title = riderTarget()?.title ?? "";
    check(
      Boolean(signWait) && title.endsWith(` · ${signWait}`),
      `the rider's wait "${title}" differs from the stop sign's "${signWait}"`,
    );
    await resume("Resume from the rider's tray did not resume the bin");
  }
  // The bus too, from the keyboard (a click with no pointer).
  await waitFor(
    () => host.querySelector(".town-bus-hold") !== null,
    "the bus never came",
    8_000,
  );
  await opens(
    host.querySelector<HTMLElement>(".town-bus-hold")!,
    "tapping the bus did not open the bin tray",
  );
  check(
    /^at the (main stop|stop by .+)/.test(
      host.querySelector(".world-bin-card-place")?.textContent ?? "",
    ),
    "the common tray does not show the rider's assigned stop",
  );
  // Resume at a coherent service sample: countdown over, active trip clock
  // past the approach, so the bus is leaving.
  for (const entry of bin.state.entries) {
    entry.remaining_ms = BIN_DEPARTURE_MS - 300;
    entry.trip_elapsed_ms = 30_000 + 300;
  }
  await resume("Resume did not resume the bin");
  const leaving = () =>
    host.querySelector<HTMLElement>('.town-bus-hold[data-phase="departing"]');
  await waitFor(() => leaving() !== null, "the bus did not drive away");
  check(
    /leaving/.test(host.querySelector(".town-bus-sign")?.textContent ?? ""),
    "the stop's sign does not say the bus is leaving",
  );
  // A tap on the leaving bus still stops it there.
  await opens(leaving()!, "tapping the leaving bus did not stop it");
  await waitFor(
    () => /departure held/.test(held()?.textContent ?? ""),
    "the held tray does not say the departure is held",
  );
  // Put back from the tray returns the rider to its desk.
  host.querySelector<HTMLButtonElement>(".town-bus-held li button")!.click();
  await waitFor(
    () => bin.calls.some((call) => call.method === "world.bin.restore"),
    "Put back did not restore the rider",
  );
  await waitFor(atDesk, "the rider did not return to its desk");
  // Boarding: a second agent joins the first one's bus, and the countdown
  // starts again in full for both (the service's rule, mirrored here).
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
    // Both go back from the common tray, one tap each. Before each tap the
    // tray must show exactly the riders still in the bin; the tap must
    // restore the card it was made on, and that card must then leave the
    // tray (which shuts once the bin is empty) before the next tap.
    await opens(
      host.querySelector<HTMLElement>(".town-bus-stop")!,
      "the stop did not open the tray for two riders",
    );
    const cards = () =>
      [...(held()?.querySelectorAll<HTMLElement>("[data-bin-entry]") ?? [])]
        .map((card) => card.dataset.binEntry!)
        .join();
    const state = () =>
      JSON.stringify({
        entries: bin.state.entries.map((e) => e.id),
        cards: cards(),
        paused: bin.state.paused,
        calls: bin.calls.slice(-6).map((c) => [c.method, c.params]),
        tray: held()?.textContent ?? null,
        toast: host.querySelector(".town-bus-toast")?.textContent ?? null,
      });
    for (const left of [1, 0]) {
      await waitFor(
        () => cards() === bin.state.entries.map((e) => e.id).join(),
        () => `the tray does not show the riders in the bin ${state()}`,
      );
      const card = held()!.querySelector<HTMLElement>("[data-bin-entry]")!;
      const id = card.dataset.binEntry!;
      const restores = () =>
        bin.calls.filter(
          (call) =>
            call.method === "world.bin.restore" && call.params.id === id,
        ).length;
      card.querySelector<HTMLButtonElement>("button")!.click();
      await waitFor(
        () =>
          restores() === 1 &&
          bin.state.entries.length === left &&
          !bin.state.entries.some((e) => e.id === id) &&
          (left
            ? cards() === bin.state.entries.map((e) => e.id).join()
            : held() === null),
        () =>
          `a rider was not put back ${JSON.stringify({ left, id })} ${state()}`,
      );
    }
  }
  check(
    !bin.calls.some((call) => call.method === "world.bin.close_now"),
    "the bus closed something",
  );
}
