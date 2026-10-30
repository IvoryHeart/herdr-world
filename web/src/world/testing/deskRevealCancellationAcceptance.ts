import { worldLocalStorage } from "../../browserStorage";
import { writeHostsFilter } from "../hostsFilter";

type Evidence = {
  check(value: boolean, message: string): void;
  waitFor(condition: () => boolean, message: string): Promise<void>;
  frame(): Promise<void>;
  calls: string[];
  dispatches: Array<{ connectionId: string; method: string }>;
  inspectorForHost(element: Element | null, id: string): boolean;
  holdPaneRead(skip: number): { started: Promise<void>; release(): void };
};

/** Real shell and Inspector controller: cancel a live read and an already queued focus. */
export async function runDeskRevealCancellationAcceptance({
  check,
  waitFor,
  frame,
  calls,
  dispatches,
  inspectorForHost,
  holdPaneRead,
}: Evidence) {
  const inspector = () =>
    [
      ...document.querySelectorAll<HTMLElement>(".world-floating-terminal"),
    ].find((element) => inspectorForHost(element, "beta"));
  const host = () =>
    [...document.querySelectorAll<HTMLButtonElement>("button.desk-host")].find(
      (button) => button.textContent?.includes("Synthetic beta"),
    );
  const view = async (name: string) => {
    const select = document.querySelector<HTMLSelectElement>(
      'select[aria-label="World view"]',
    )!;
    select.value = name;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(
      () =>
        !!document.querySelector(
          `.world-view-stage[aria-label="${name} view"]`,
        ),
      "View did not change to " + name,
    );
    await frame();
  };
  for (const skip of [0, 1]) {
    inspector()
      ?.querySelector<HTMLButtonElement>('button[title="Close window"]')!
      .click();
    await waitFor(() => !inspector(), "Previous beta Inspector did not close");
    writeHostsFilter(["alpha"]);
    await waitFor(
      () => !!host(),
      "Beta summary did not return for cancellation",
    );
    host()!.click();
    await frame();
    const held = holdPaneRead(skip);
    const beforeCalls = calls.length,
      beforeDispatches = dispatches.length;
    document
      .querySelector<HTMLButtonElement>(".desk-host-agents li button")!
      .click();
    try {
      await held.started;
      await view("board");
      await view("desk");
    } finally {
      held.release();
    }
    if (skip === 1)
      await waitFor(
        () => calls.slice(beforeCalls).includes("focus:settled:beta"),
        "Cancelled native focus did not settle",
      );
    await frame();
    check(
      !inspector(),
      "Cancelled reveal admitted an Inspector after returning to Desk",
    );
    check(
      !calls.slice(beforeCalls).includes("world.desk.open"),
      "Cancelled reveal was recorded as a recent open",
    );
    if (skip === 0) {
      check(
        worldLocalStorage.getItem("worldHostsFilter.v1") === '["alpha"]',
        "Departed live read widened Hosts after return",
      );
      check(
        !calls.slice(beforeCalls).includes("focus:beta"),
        "Departed live read started Inspector focus",
      );
    }
    check(
      !dispatches
        .slice(beforeDispatches)
        .some(
          (call) =>
            call.connectionId === "beta" &&
            (call.method === "workspace.focus" || call.method === "tab.focus"),
        ),
      "Cancelled reveal dispatched native focus after departure",
    );
  }
}
