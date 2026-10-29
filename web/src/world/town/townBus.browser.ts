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

  sendToBusStop(agentKey);
  await waitFor(
    () => calls("world.bin.add") === 1,
    "the stop never took the agent",
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
}
