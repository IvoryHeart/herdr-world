import type { createFakeBin } from "../testing/fakeBin";
import { townBusSender } from "./useTownBus";

/**
 * Town's bus against the real scene and a fixture bin service: an agent sent
 * to the stop goes in qualified, leaves its desk and rides; holding the bus
 * pauses every countdown; Let it go resumes; pressing the rider puts it back.
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
  const pauses = () =>
    bin.calls.filter((call) => call.method === "world.bin.pause").length;
  const resumes = () =>
    bin.calls.filter((call) => call.method === "world.bin.resume").length;
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
    ".town-bus-held .town-bus-go",
  )!;
  const back = host.querySelector<HTMLButtonElement>(
    ".town-bus-held li button",
  )!;
  check(reachable(go), "Let it go is covered or off screen");
  check(reachable(back), "Put back on the held bus is covered or off screen");
  go.click();
  await waitFor(() => resumes() === 1, "Let it go did not resume the bin");
  await waitFor(
    () => host.querySelector(".town-bus-held") === null,
    "the held controls stayed after Let it go",
  );

  // The pointer path still holds on a press.
  host
    .querySelector<HTMLElement>(".town-bus-hold")!
    .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  await waitFor(() => pauses() === 2, "holding the bus did not pause the bin");
  host
    .querySelector<HTMLElement>(".town-bus-hold")!
    .dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  await waitFor(
    () => host.querySelector(".town-bus-held .town-bus-go") !== null,
    "a held bus offers no Let it go",
  );
  host.querySelector<HTMLButtonElement>(".town-bus-held .town-bus-go")!.click();
  await waitFor(() => resumes() === 2, "Let it go did not resume the bin");

  // Pressing the rider sends it back to its desk; nothing is closed.
  host.querySelector<HTMLButtonElement>(".town-bus-rider")!.click();
  await waitFor(
    () => bin.calls.some((call) => call.method === "world.bin.restore"),
    "pressing the rider did not put it back",
  );
  await waitFor(atDesk, "the rider did not return to its desk");
  check(
    !bin.calls.some((call) => call.method === "world.bin.close_now"),
    "the bus closed something",
  );
}
