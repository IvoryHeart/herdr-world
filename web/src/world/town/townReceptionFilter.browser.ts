import { connectTownReceptionFilter } from "./townReceptionSetting";

/**
 * The reception filter's visibility rule in the real Town scene (#501): with
 * Done filtered, every finished agent is still seated at its desk with its
 * mark, reception keeps no finish, the Town board, building sign, room
 * plaques and Needs you count are unchanged (accessible targets follow the
 * bodies on screen, so they are not counted as facts), find picks the kept agents out
 * and Next walks them, and Reset to default for all buildings brings
 * everyone back.
 */
export async function checkTownReceptionFilter(
  host: HTMLElement,
  check: (condition: boolean, message: string) => void,
  waitFor: (
    condition: () => boolean,
    message: string | (() => string),
  ) => Promise<void>,
) {
  await waitFor(
    () => window.__HERDR_TOWN_RENDERER__?.ready === true,
    "the reception fixture's renderer never became ready",
  );
  const renderer = window.__HERDR_TOWN_RENDERER__!;
  // The World service's write path; the fixture has no socket.
  const saved: unknown[] = [];
  connectTownReceptionFilter(async (value) => {
    saved.push(value);
  });
  const facts = () =>
    JSON.stringify([
      host.querySelector(".town-board-counts")?.textContent ??
        host.querySelector(".town-board-chip")?.getAttribute("aria-label"),
      document.querySelector(".needs-you-counter")?.getAttribute("aria-label"),
      [
        ...host.querySelectorAll(".town-building-sign .town-reception-tags"),
      ].map((tags) => tags.textContent),
      [...host.querySelectorAll(".town-room-plaque-count")].map((count) =>
        count.getAttribute("title"),
      ),
    ]);
  const finished = () =>
    [
      ...host.querySelectorAll<HTMLElement>(
        '.world-semantic-target[data-kind="agent"]',
      ),
    ]
      .filter((target) =>
        target.getAttribute("aria-label")?.includes(", done, desk "),
      )
      .map((target) => target.dataset.targetKey ?? "");
  await waitFor(
    () =>
      finished().length > 0 &&
      host.querySelector(".town-reception-done") !== null &&
      host.querySelector(".town-reception-sign") !== null,
    "the reception fixture has no finished visitor or no reception sign",
  );
  const before = facts();
  const sign = () =>
    [...host.querySelectorAll<HTMLButtonElement>(".town-reception-sign")].find(
      (button) =>
        button
          .closest(".town-reception")
          ?.querySelector(".town-reception-done"),
    ) ?? host.querySelector<HTMLButtonElement>(".town-reception-sign")!;
  const box = sign().getBoundingClientRect();
  if (window.innerWidth <= 640)
    check(
      box.width >= 40 && box.height >= 40,
      `the phone reception sign is ${box.width}×${box.height}, under 40 px`,
    );
  check(
    sign().querySelectorAll('[data-taken="false"]').length === 0,
    "the default reception sign greys a mark",
  );
  sign().click();
  const filter = () =>
    document.querySelector<HTMLElement>(".town-reception-filter");
  await waitFor(() => filter() !== null, "the reception sign opened no filter");
  const doneBox = [...filter()!.querySelectorAll("label")]
    .find((label) => label.textContent?.includes("Done"))
    ?.querySelector<HTMLInputElement>("input");
  check(doneBox?.checked === true, "Done is not ticked by default");
  const allBox = () =>
    [...filter()!.querySelectorAll("label")]
      .find((label) => label.textContent?.includes("Apply to all buildings"))
      ?.querySelector<HTMLInputElement>("input");
  check(allBox()?.checked === false, "Apply to all buildings starts ticked");
  // Every building's finished agents stay at their desks.
  allBox()?.click();
  doneBox?.click();
  const kept = finished();
  await waitFor(
    () =>
      kept.every((key) => renderer.held.includes(key)) &&
      renderer.walking === 0 &&
      host.querySelector(".town-reception-done") === null,
    () =>
      `finished agents did not all return to their desks: ${kept.length} finished, ${renderer.held.length} seated, ${renderer.walking} walking`,
  );
  check(
    JSON.stringify(saved[saved.length - 1]) ===
      JSON.stringify({ default: ["blocked", "ask"], hosts: {} }),
    `the filter was not saved to World: ${JSON.stringify(saved)}`,
  );
  check(renderer.actors >= kept.length, "a filtered agent left the scene");
  check(
    facts() === before,
    `filtering changed facts: ${before} became ${facts()}`,
  );
  check(
    sign().querySelector('[data-taken="false"]') !== null,
    "the reception sign does not grey the filtered mark",
  );
  // Close the filter; the tag counts the kept agents and finds them.
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  await waitFor(() => filter() === null, "Escape did not close the filter");
  const tag = [
    ...host.querySelectorAll<HTMLElement>("[data-reception-held]"),
  ].find((element) => element.querySelector(".town-reception-find"));
  check(
    tag !== undefined && /\d+\s*at desks/.test(tag.textContent ?? ""),
    "reception has no count tag with find",
  );
  tag?.querySelector<HTMLButtonElement>(".town-reception-find")?.click();
  const peeked = () =>
    host.ownerDocument.querySelector<HTMLElement>(".town-peek")?.dataset
      .agentKey ?? "";
  await waitFor(
    () => kept.includes(peeked()),
    "find did not show an agent kept at its desk",
  );
  const first = peeked();
  const next = [
    ...host.ownerDocument.querySelectorAll<HTMLButtonElement>(
      ".town-peek button",
    ),
  ].find((button) => button.textContent?.includes("Next"));
  if (next) {
    next.click();
    await waitFor(
      () => peeked() !== first && kept.includes(peeked()),
      "Next did not walk to another agent kept at its desk",
    );
  }
  host.ownerDocument
    .querySelector<HTMLButtonElement>(".town-peek-close")
    ?.click();
  // Reset to default: everyone who belongs at reception walks back.
  sign().click();
  await waitFor(() => filter() !== null, "the reception sign did not reopen");
  check(allBox()?.checked === false, "Apply to all buildings stayed ticked");
  allBox()?.click();
  [...filter()!.querySelectorAll("button")]
    .find((button) => button.textContent === "Reset to default")
    ?.click();
  await waitFor(
    () =>
      renderer.held.length === 0 &&
      host.querySelector("[data-reception-held]") === null &&
      host.querySelector(".town-reception-done") !== null,
    "Reset to default did not bring finished agents back to reception",
  );
  check(saved[saved.length - 1] === undefined, "the reset was not saved");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  check(facts() === before, "resetting the filter changed facts");
}
