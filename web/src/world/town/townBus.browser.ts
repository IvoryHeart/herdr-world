import type { fakeBinService } from "../bin/binTestService";
import { sendToBusStop } from "./useTownBus";

type Check = (condition: boolean, message: string) => void;
type WaitFor = (
  condition: () => boolean,
  message: string | (() => string),
) => Promise<void>;

/**
 * The London bus stop against the real Town scene: an agent sent to the stop
 * catches the bus, press and hold stops it with its doors open, a passenger
 * dragged off goes back to their desk, and Let it go drives on.
 */
export async function checkTownBus(
  host: HTMLElement,
  check: Check,
  waitFor: WaitFor,
  bin: ReturnType<typeof fakeBinService>,
  agentKey: string,
  phone: boolean,
) {
  const renderer = window.__HERDR_TOWN_RENDERER__!;
  await waitFor(() => Boolean(renderer.bus), "Town never drew its bus stop");
  check(
    (renderer.bus?.buses.length ?? 1) === 0,
    "no bus runs while the bin is empty",
  );
  const canvas = host.querySelector("canvas")!.parentElement!;
  const origin = () => canvas.getBoundingClientRect();
  const point = (type: string, x: number, y: number) =>
    canvas.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 47,
        pointerType: phone ? "touch" : "mouse",
        isPrimary: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX: origin().left + x,
        clientY: origin().top + y,
      }),
    );
  const pause = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  const calls = (method: string) =>
    bin.calls.filter((call) => call.method === method).length;

  // The stop keeps the screen's top-right corner.
  const { width: screenW } = origin();
  const stop = renderer.bus!.stop;
  check(
    stop.x > screenW * 0.75 && stop.y < 200,
    `the bus stop is not in the top-right corner: ${JSON.stringify(stop)}`,
  );

  // Carry the agent from its desk to the stop: it goes, and the town holds
  // still while it hovers there, so the drop lands.
  const figure = host.querySelector<HTMLElement>(
    `.world-semantic-target[data-kind="agent"][data-target-key="${CSS.escape(agentKey)}"]`,
  );
  check(figure !== null, "the agent has no target to carry");
  if (figure) {
    // Agents are carried at room or desk level: tap the agent's room card
    // (the nearest to it), as a person zooms in, then focus the agent.
    const centre = (element: Element) => {
      const r = element.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const at = centre(figure);
    const cards = [...host.querySelectorAll<HTMLElement>(".town-room-card")];
    const card = cards.sort((a, b) => {
      const da = centre(a);
      const db = centre(b);
      return (
        Math.hypot(da.x - at.x, da.y - at.y) -
        Math.hypot(db.x - at.x, db.y - at.y)
      );
    })[0];
    if (renderer.level !== "room" && renderer.level !== "desk") card?.click();
    figure.focus();
    await waitFor(
      () =>
        !renderer.flying &&
        (renderer.level === "room" || renderer.level === "desk"),
      () => `focusing the agent left the camera at ${renderer.level}`,
    );
    await pause(100);
    const box = figure.getBoundingClientRect();
    const from = {
      x: box.left + box.width / 2 - origin().left,
      y: box.top + box.height / 2 - origin().top,
    };
    const to = { x: stop.x - 10, y: stop.y - 30 };
    point("pointerdown", from.x, from.y);
    if (phone) await pause(700);
    for (let i = 1; i <= 12; i++) {
      point(
        "pointermove",
        from.x + ((to.x - from.x) * i) / 12,
        from.y + ((to.y - from.y) * i) / 12,
      );
      await pause(16);
    }
    await waitFor(
      () => {
        const ghost = host.querySelector<HTMLElement>(".town-drag-ghost");
        return (
          ghost?.dataset.action === "bin" && ghost.dataset.valid === "true"
        );
      },
      () =>
        `a carried agent over the stop is not aimed at it: ${host.querySelector<HTMLElement>(".town-drag-ghost")?.textContent ?? "no ghost"}`,
    );
    // The agent's target sits on the map: it moves if the camera pans.
    const before = figure.getBoundingClientRect();
    await pause(300);
    const after = figure.getBoundingClientRect();
    check(
      Math.abs(after.left - before.left) < 1 &&
        Math.abs(after.top - before.top) < 1,
      "the town panned while the agent hovered over the stop",
    );
    point("pointerup", to.x, to.y);
  }
  await waitFor(
    () => calls("world.bin.add") === 1,
    "dropping the agent on the stop never took it",
  );
  const added = bin.calls.find((call) => call.method === "world.bin.add")!;
  check(
    added.params.view === "town" && typeof added.params.pane_id === "string",
    "the bus stop sends one qualified pane, from Town",
  );
  await waitFor(
    () => renderer.bus?.hidden.includes(agentKey) === true,
    "the agent never left their desk for the stop",
  );
  await waitFor(
    () => (renderer.bus?.buses[0]?.passengers ?? 0) === 1,
    "the bus never pulled in and took the agent aboard",
  );
  const timetable = host.querySelector<HTMLElement>(".town-bus-timetable")!;
  await waitFor(
    () =>
      !timetable.hidden &&
      /Bus boarding · \d+s/.test(timetable.textContent ?? ""),
    () => `the timetable reads "${timetable.textContent}"`,
  );

  // Press and hold the bus: it stops, opens its doors and pauses the bin.
  const bus = renderer.bus!.buses[0]!;
  point("pointerdown", bus.x + bus.w / 2, bus.y + bus.h * 0.75);
  await pause(500);
  point("pointerup", bus.x + bus.w / 2, bus.y + bus.h * 0.75);
  await waitFor(
    () => calls("world.bin.pause") === 1,
    "holding the bus never paused it",
  );
  await waitFor(
    () => Boolean(host.querySelector(".town-bus-held")),
    "a held bus offers Let it go",
  );
  check(renderer.bus!.held, "the bus shows as held");

  // Drag the passenger off: they go back to their desk; the empty bus leaves.
  const seat = renderer.bus!.buses[0]!.seats[0]!;
  point("pointerdown", seat.x, seat.y);
  for (let i = 1; i <= 8; i++) {
    point("pointermove", seat.x - i * 20, seat.y - i * 30);
    await pause(16);
  }
  const ghost = host.querySelector<HTMLElement>(".town-drag-ghost");
  check(
    ghost?.dataset.valid === "true" &&
      (ghost.textContent ?? "").startsWith("Back to "),
    "a passenger carried off the bus heads back to their desk",
  );
  point("pointerup", seat.x - 160, seat.y - 240);
  await waitFor(
    () => calls("world.bin.restore") === 1,
    "the passenger never got off",
  );
  await waitFor(
    () => renderer.bus?.hidden.length === 0,
    "the passenger never returned to their desk",
  );
  await waitFor(
    () => (renderer.bus?.buses ?? []).every((item) => item.departing),
    "the empty bus never pulled away",
  );
  check(calls("world.bin.close_now") === 0, "getting off closes nothing");

  // Send them again, hold, and Let it go: the bin resumes.
  sendToBusStop(agentKey);
  await waitFor(
    () => calls("world.bin.add") === 2,
    "the stop never took the agent again",
  );
  await waitFor(
    () =>
      (renderer.bus?.buses.find((item) => !item.departing)?.passengers ?? 0) ===
      1,
    "the next bus never took the agent aboard",
  );
  const next = renderer.bus!.buses.find((item) => !item.departing)!;
  point("pointerdown", next.x + next.w / 2, next.y + next.h * 0.75);
  await pause(500);
  point("pointerup", next.x + next.w / 2, next.y + next.h * 0.75);
  await waitFor(
    () => Boolean(host.querySelector(".town-bus-held button")),
    "the bus was not held a second time",
  );
  host.querySelector<HTMLButtonElement>(".town-bus-held button")!.click();
  await waitFor(
    () => calls("world.bin.resume") === 1,
    "Let it go never resumed the bin",
  );

  // The countdown ends: the bus leaves town and says who it took.
  bin.expire(bin.entries()[0]!.id);
  await waitFor(
    () =>
      /The bus left town\./.test(
        host.querySelector(".town-bus-receipt")?.textContent ?? "",
      ),
    "the close never showed its receipt",
  );

  const parked = () =>
    (renderer.bus?.buses ?? []).filter((item) => !item.departing);
  const holdBus = async (index = 0) => {
    const target = parked()[index]!;
    point("pointerdown", target.x + target.w / 2, target.y + target.h * 0.75);
    await pause(500);
    point("pointerup", target.x + target.w / 2, target.y + target.h * 0.75);
    await waitFor(() => renderer.bus!.held, "the bus was not held");
  };

  // Another World resumes the bin: the bus held here drives on too.
  sendToBusStop(agentKey);
  await waitFor(
    () => parked()[0]?.passengers === 1,
    "the agent never boarded a third time",
  );
  await holdBus();
  await waitFor(() => bin.state().paused, "the hold never paused the bin");
  await bin.call("world.bin.resume");
  await waitFor(
    () => !renderer.bus!.held && !host.querySelector(".town-bus-held"),
    "a resume from another World left this bus held",
  );
  bin.expire(bin.entries()[0]!.id);
  await waitFor(() => parked().length === 0, "the third bus never left");

  // More passengers than a bus seats, and a second, later trip: every
  // passenger has a seat, no bus hides another, and the one pressed is the
  // one that gets off.
  const rider = (index: number, join?: string) =>
    bin.call("world.bin.add", {
      connection_id: "local",
      connection_generation: 1,
      workspace_id: "w-bus",
      tab_id: `t-bus-${index}`,
      pane_id: `p-bus-${index}`,
      terminal_id: `term-bus-${index}`,
      label: `rider ${index}`,
      view: "board",
      join,
      // Long enough that no bus starts to leave while the suite looks.
      duration_ms: 120_000,
    });
  const riders = 6;
  await rider(0);
  const first = bin.entries()[0]!.id;
  for (let i = 1; i < riders; i += 1) await rider(i, first);
  await waitFor(
    () =>
      parked().reduce((sum, item) => sum + item.passengers, 0) === riders &&
      parked().every((item) => item.passengers <= 5),
    () =>
      `${riders} riders sat ${JSON.stringify(parked().map((item) => item.passengers))}`,
  );
  await rider(riders);
  const late = bin.entries()[bin.entries().length - 1]!.id;
  await waitFor(
    () => parked().length === 3,
    () => `the later trip ran ${parked().length} buses`,
  );
  const boxes = parked();
  check(
    boxes.every((a, i) =>
      boxes.every((b, j) => i === j || a.x + a.w <= b.x || b.x + b.w <= a.x),
    ),
    `parked buses overlap: ${JSON.stringify(boxes.map((item) => [item.x, item.w]))}`,
  );
  const { width, height } = origin();
  // Once the later bus has pulled in, every bus and passenger is on screen.
  await waitFor(
    () =>
      parked().every((item) =>
        item.seats.every(
          (seat) =>
            seat.x >= 0 && seat.x <= width && seat.y >= 0 && seat.y <= height,
        ),
      ) &&
      parked().every((item) => item.x >= 0 && item.x + item.w <= width + 1),
    () =>
      `a parked bus or passenger left the screen: ${JSON.stringify(parked().map((item) => [item.x, item.y, item.w]))}`,
  );
  const lateBus = parked().length - 1;
  await waitFor(
    () => parked()[lateBus]?.passengers === 1,
    "the later bus never took its rider aboard",
  );
  await holdBus(0);
  const lateSeat = parked()[lateBus]!.seats[0]!;
  const restores = calls("world.bin.restore");
  point("pointerdown", lateSeat.x, lateSeat.y);
  for (let i = 1; i <= 8; i++) {
    point("pointermove", lateSeat.x - i * 10, lateSeat.y - i * 30);
    await pause(16);
  }
  point("pointerup", lateSeat.x - 80, lateSeat.y - 240);
  await waitFor(
    () => calls("world.bin.restore") === restores + 1,
    "the later rider never got off",
  );
  const restored = bin.calls.filter(
    (call) => call.method === "world.bin.restore",
  );
  check(
    restored[restored.length - 1]!.params.id === late,
    "dragging the later rider off restored a different agent",
  );
  bin.reset();
}
