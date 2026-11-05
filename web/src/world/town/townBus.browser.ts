import { BIN_DEPARTURE_MS } from "../../../../shared/bin";
import type { createFakeBin } from "../testing/fakeBin";
import { BUS_H, BUS_W } from "./townBusGeometry";
import { townBusSender } from "./useTownBus";
import { bridge } from "../../api";
import { worldBinStore } from "../bin/binStore";
import { townBusClockSample } from "./townBusClock.browser";

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
  const clock = townBusClockSample(host);
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
  // Bind the incoming hit-region check to a source-clock sample on the
  // occupied road, after the real chip/stop navigation has finished.
  const store0 = worldBinStore(bridge);
  const current = store0.elapsed(store0.get().entries[0]!);
  const lead = Math.max(clock.lead, Math.ceil(current) + 1);
  const setupWitness = {
    setup: {
      current,
      requestedLead: clock.lead,
      lead,
      before: clock.before,
      arrival: clock.arrival,
    },
    drawn0: 0,
    handshake: [] as unknown[],
    accepted: null as unknown,
  };
  const receipts = new URL(location.href).searchParams.has("releaseWitness");
  if (receipts) {
    // Add this fixture's receipt to the existing private output, preserving
    // every original release record and leaving the runner unchanged.
    const originalFetch = window.fetch.bind(window);
    window.fetch = Object.assign(
      (input: RequestInfo | URL, init?: RequestInit) => {
        if (input === "/release-witness" && typeof init?.body === "string") {
          window.fetch = originalFetch;
          return originalFetch(input, {
            ...init,
            body: JSON.stringify({
              ...JSON.parse(init.body),
              busClockSetup: setupWitness,
            }),
          });
        }
        return originalFetch(input, init);
      },
      originalFetch,
    );
  }
  if (
    !Number.isFinite(current) ||
    !Number.isFinite(lead) ||
    lead < current ||
    lead >= clock.before
  )
    throw new Error(
      `the trip clock is already past the lead-in ${JSON.stringify(setupWitness.setup)}`,
    );
  for (const entry of bin.state.entries)
    Object.assign(entry, {
      trip_duration_ms: 30_000,
      trip_elapsed_ms: lead,
    });
  bin.state.revision++;
  const drawn0 = window.__HERDR_TOWN_RENDERER__?.frames ?? 0;
  setupWitness.drawn0 = drawn0;
  await store0.refresh();
  const snapshot = () => {
    const entry = store0.get().entries[0];
    const bus = host.querySelector<HTMLElement>(".town-bus-hold");
    const rect = bus?.getBoundingClientRect();
    const scale =
      rect && bus?.offsetWidth ? rect.width / bus.offsetWidth : null;
    const point =
      rect && scale
        ? [rect.right - (BUS_W / 2) * scale, rect.bottom - 4 * scale]
        : null;
    const top = point ? document.elementFromPoint(point[0]!, point[1]!) : null;
    const elapsed = entry ? store0.elapsed(entry) : null;
    return {
      sourceElapsed: elapsed,
      expectedPlanPose: elapsed === null ? null : clock.position(elapsed),
      frame: window.__HERDR_TOWN_RENDERER__?.frames ?? 0,
      domElapsed: bus?.dataset.tripElapsed ?? null,
      phase: bus?.dataset.phase ?? null,
      left: bus?.style.left ?? null,
      top: bus?.style.top ?? null,
      offsetWidth: bus?.offsetWidth ?? null,
      offsetHeight: bus?.offsetHeight ?? null,
      rect: rect?.toJSON() ?? null,
      hit: {
        point,
        tag: top?.tagName ?? null,
        class: top?.getAttribute("class") ?? null,
        isBus: !!top && !!bus?.contains(top),
      },
      viewport: {
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
      },
    };
  };
  // Readiness is a new drawn frame on this clock, not a latency promise.
  // The original acceptance window below still rejects a missed arrival.
  await waitFor(
    () => {
      const frame = window.__HERDR_TOWN_RENDERER__?.frames ?? 0;
      const elapsed = Number(
        host.querySelector<HTMLElement>(".town-bus-hold")?.dataset.tripElapsed,
      );
      if (receipts) setupWitness.handshake.push(snapshot());
      return frame > drawn0 && elapsed >= lead;
    },
    () =>
      `the bus did not draw the led-in clock ${JSON.stringify(setupWitness)}`,
  );
  const clockWitnesses: unknown[] = [];
  await waitFor(
    () => {
      const bus = host.querySelector<HTMLElement>(
        '.town-bus-hold[data-phase="arriving"]',
      );
      const elapsed = Number(bus?.dataset.tripElapsed);
      const store = worldBinStore(bridge);
      const sample = store.elapsed(store.get().entries[0]!);
      const pose = clock.position(sample);
      if (!pose.arrived && clockWitnesses.length < 24) {
        const layer = host.querySelector<HTMLElement>(".town-world")!;
        const matrix = new DOMMatrix(getComputedStyle(layer).transform);
        const canvas = host
          .querySelector("canvas[data-office-canvas]")!
          .getBoundingClientRect();
        const point = [
          canvas.left + matrix.e + matrix.a * (pose.x + BUS_W / 2),
          canvas.top + matrix.f + matrix.d * (pose.y + BUS_H - 4),
        ];
        const top = document.elementFromPoint(point[0]!, point[1]!);
        clockWitnesses.push({
          sourceElapsed: sample,
          pose,
          drawnFrame: window.__HERDR_TOWN_RENDERER__?.frames,
          domElapsed: bus?.dataset.tripElapsed,
          anyBus: [...host.querySelectorAll<HTMLElement>(".town-bus-hold")].map(
            (b) => ({
              elapsed: b.dataset.tripElapsed,
              phase: b.dataset.phase,
              rect: b.getBoundingClientRect().toJSON(),
            }),
          ),
          point,
          top: top && {
            class: top.getAttribute("class"),
            label: top.getAttribute("aria-label"),
          },
          inViewport:
            point[0]! >= 0 &&
            point[0]! < innerWidth &&
            point[1]! >= 0 &&
            point[1]! < innerHeight,
        });
      }
      return elapsed >= clock.before && elapsed < clock.arrival;
    },
    () =>
      `incoming bus did not draw the expected active-clock sample ${JSON.stringify(
        {
          clock,
          clockWitnesses,
          layout: window.__HERDR_TOWN_RENDERER__?.layout,
          frame: window.__HERDR_TOWN_RENDERER__?.frames,
          entries: worldBinStore(bridge).get().entries,
          buses: [...host.querySelectorAll<HTMLElement>(".town-bus-hold")].map(
            (bus) => ({
              phase: bus.dataset.phase,
              elapsed: bus.dataset.tripElapsed,
              left: bus.style.left,
              top: bus.style.top,
            }),
          ),
          stops: [...host.querySelectorAll<HTMLElement>(".town-bus-stop")].map(
            (stop) => ({
              id: stop.dataset.stop,
              left: stop.style.left,
              top: stop.style.top,
            }),
          ),
        },
      )}`,
  );
  if (receipts) setupWitness.accepted = snapshot();
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
    `the waiting bus is covered where a finger would hold it ${JSON.stringify({
      rect: holdAt.toJSON(),
      point: [
        holdAt.right - (BUS_W / 2) * holdScale,
        holdAt.bottom - 4 * holdScale,
      ],
      phase: holdTarget.dataset.phase,
      elapsed: holdTarget.dataset.tripElapsed,
      frame: window.__HERDR_TOWN_RENDERER__?.frames,
      viewport: [innerWidth, innerHeight],
      top: (() => {
        const e = document.elementFromPoint(
          holdAt.right - (BUS_W / 2) * holdScale,
          holdAt.bottom - 4 * holdScale,
        );
        return (
          e && {
            tag: e.tagName,
            class: e.className,
            label: e.getAttribute("aria-label"),
          }
        );
      })(),
    })}`,
  );
  host.querySelector<HTMLButtonElement>(".town-bus-hold")!.click();
  await waitFor(() => pauses() === 1, "Enter on the bus did not hold it");

  // Held: its controls are in screen space, inside the viewport and on top
  // of whatever the town shows there (the asks rail included).
  await waitFor(
    () => host.querySelector(".town-bus-held") !== null,
    "a held bus shows no controls",
  );
  check(
    /^at the (main stop|stop by .+)/.test(
      host.querySelector(".world-bin-card-place")?.textContent ?? "",
    ),
    "the common tray does not show the rider's assigned stop",
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
  // Resume at a coherent service sample: countdown over, active trip clock
  // past the approach. Changing just remaining_ms would depart from a bus
  // still at its incoming position, which the real service cannot publish.
  for (const entry of bin.state.entries) {
    entry.remaining_ms = BIN_DEPARTURE_MS - 300;
    entry.trip_elapsed_ms = 30_000 + 300;
  }
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
