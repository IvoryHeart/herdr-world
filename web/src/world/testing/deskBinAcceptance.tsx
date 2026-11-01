import { bridge } from "../../api";
import { setTabPinned } from "../../tabPins";
import { worldBinStore } from "../bin/binStore";
import type { WorldLeafObject } from "../worldObject";
import type { createFakeBin } from "./fakeBin";

/** Real Desk controls and card pointer handlers; the fixture never closes Herdr. */
export async function checkDeskBin(
  bin: ReturnType<typeof createFakeBin>,
  leaves: WorldLeafObject[],
  render: () => void,
  check: (condition: boolean, message: string) => void,
) {
  const wait = (condition: () => boolean, message: string) =>
    new Promise<void>((resolve, reject) => {
      const done = () => {
        if (condition()) {
          observer.disconnect();
          clearTimeout(timer);
          resolve();
        }
      };
      const observer = new MutationObserver(done);
      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(message));
      }, 3000);
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
      });
      done();
    });
  const card = (id: string) =>
    document.querySelector<HTMLElement>(`[data-desk-card="${id}"]`);
  const button = (root: Element, text: string) =>
    [...root.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === text,
    )!;
  const store = worldBinStore(bridge);
  await store.refresh();
  button(card("alpha")!, "Close agent…").click();
  await wait(() => !card("alpha"), "Desk Close agent did not hide its card");
  const first = bin.calls.find(
    (call) => call.method === "world.bin.add",
  )!.params;
  check(
    first.view === "desk" &&
      first.connection_id === "local" &&
      first.connection_generation === 1 &&
      first.workspace_id === "w1" &&
      first.tab_id === "t-alpha" &&
      first.pane_id === "w1:alpha" &&
      first.terminal_id === "alpha",
    "I3: Desk Close agent must send its exact qualified pane with view desk",
  );
  document.querySelector<HTMLButtonElement>(".world-bin-can")!.click();
  await wait(
    () => !!document.querySelector(".world-bin-tray"),
    "Desk bin did not open",
  );
  button(document.querySelector(".world-bin-tray")!, "Put back").click();
  await wait(() => !!card("alpha"), "Desk Put back did not restore card");
  document
    .querySelector<HTMLButtonElement>(".world-bin-tray")
    ?.querySelector<HTMLButtonElement>("header button")
    ?.click();
  const drag = async (id: string, cancel = false, during?: () => void) => {
    const node = card(id)!;
    const box = node.getBoundingClientRect();
    const send = (type: string, x: number, y: number) =>
      node.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 87,
          pointerType: "mouse",
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
          clientX: x,
          clientY: y,
        }),
      );
    send("pointerdown", box.left + 10, box.top + 10);
    send("pointermove", box.left + 30, box.top + 20);
    await wait(
      () => !!document.querySelector(".desk-bin-ghost"),
      "Desk card did not lift",
    );
    const can = document
      .querySelector(".world-bin-can")!
      .getBoundingClientRect();
    const x = can.left + can.width / 2,
      y = can.top + can.height / 2;
    send("pointermove", x, y);
    during?.();
    send(cancel ? "pointercancel" : "pointerup", x, y);
    await wait(
      () => !document.querySelector(".desk-bin-ghost"),
      "Desk carry did not finish",
    );
  };
  const adds = () =>
    bin.calls.filter((call) => call.method === "world.bin.add").length;
  await drag("alpha", true);
  check(
    adds() === 1 && !!card("alpha"),
    "I3: cancelled Desk carry must not stage/hide an agent",
  );
  const captured = leaves[0]!;
  await drag("alpha", false, () => {
    leaves[0] = { ...captured, generation: 2 };
    render();
  });
  check(
    adds() === 1 &&
      !!card("alpha") &&
      /changed|not ready/.test(
        document.querySelector(".desk-bin-error")?.textContent ?? "",
      ),
    "I3: a runtime replacement during Desk carry must refuse the captured target",
  );
  leaves[0] = captured;
  render();
  await drag("alpha");
  await wait(() => !card("alpha"), "Desk card drop did not enter shared bin");
  check(
    adds() === 2 &&
      bin.calls.filter((call) => call.method === "world.bin.add")[1]!.params
        .view === "desk",
    "I3: actual Desk card drop must use shared qualified admission",
  );
  await store.restore(store.get().entries[0]!.id);
  await wait(() => !!card("alpha"), "Desk restore failed");
  const mode = (name: string) =>
    [
      ...document.querySelectorAll<HTMLButtonElement>(".desk-modes button"),
    ].find((button) => button.textContent?.startsWith(name))!;
  mode("Agents").click();
  await wait(
    () => !!card("alpha")?.classList.contains("desk-row"),
    "Desk agent directory did not open",
  );
  button(card("alpha")!.closest("li")!, "Close agent…").click();
  await wait(
    () => !card("alpha"),
    "I3: directory Close agent did not stage its qualified target",
  );
  check(
    bin.calls.filter((call) => call.method === "world.bin.add").slice(-1)[0]
      ?.params.terminal_id === "alpha",
    "I3: directory close selected a different terminal",
  );
  await store.restore(store.get().entries[0]!.id);
  mode("Now").click();
  await wait(
    () => !!card("alpha")?.classList.contains("desk-card"),
    "Desk queue did not return",
  );

  // Historical R5: native topology still contains both siblings while A closes.
  const beta = leaves[1]!,
    originalTab = beta.tabId;
  beta.tabId = leaves[0]!.tabId;
  setTabPinned("local", beta.tabId, true);
  render();
  await wait(
    () => !button(card("alpha")!, "Close agent…").disabled,
    "first pinned sibling should be admissible",
  );
  bin.holdCloses = true;
  button(card("alpha")!, "Close agent…").click();
  await wait(() => !card("alpha"), "first pinned sibling not admitted");
  document.querySelector<HTMLButtonElement>(".world-bin-can")!.click();
  await wait(
    () => !!document.querySelector(".world-bin-tray"),
    "Desk tray missing",
  );
  button(document.querySelector(".world-bin-tray")!, "Close now").click();
  await wait(
    () => bin.state.closing.length === 1 && store.get().entries.length === 0,
    "held native close did not leave staging",
  );
  await wait(
    () => button(card("beta")!, "Close agent…").disabled,
    "I1/R5: Desk offered last pinned sibling during native close",
  );
  const before = adds();
  await drag("beta");
  check(
    adds() === before && !!card("beta"),
    "I1/R5: Desk drop removed the remaining pinned tab",
  );
  setTabPinned("local", beta.tabId, false);
  beta.tabId = originalTab;
  bin.holdCloses = false;
  bin.state.closing = [];
  bin.state.reservations = [];
  bin.state.revision++;
  await store.refresh();
  render();
  await wait(
    () => !!card("alpha") && !!card("beta"),
    "Desk bin fixture cleanup failed",
  );
}
