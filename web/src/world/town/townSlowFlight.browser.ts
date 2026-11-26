import { tapTownControl } from "./townRoomFold.browser";
import { prepareTownRoomCard } from "./townRoomCard.browser";
import type { TownRendererDiagnostics } from "./townDiagnostics";

/**
 * The slow portrait regression needs an expanded room and real camera flights,
 * not a second copy of the general Town interaction journey. Keep the same
 * seeded town, 100 desks, viewport and delayed frames as the full fixture.
 */
export async function checkSlowTownFlight(
  host: HTMLElement,
  diagnostics: TownRendererDiagnostics,
  check: (condition: boolean, message: string) => void,
  waitFor: (
    condition: () => boolean,
    message: string | (() => string),
  ) => Promise<void>,
  frameDelay: number,
) {
  const targets = () => [
    ...host.querySelectorAll<HTMLElement>(
      '.world-semantic-target[data-kind="desk"]',
    ),
  ];
  const orbitDesks = () =>
    targets().filter((target) =>
      target.dataset.targetKey?.includes("local-orbit-tab-"),
    );
  const room = () =>
    [...host.querySelectorAll<HTMLElement>(".town-room")].find(
      (candidate) =>
        candidate.querySelector(".town-room-plaque-name")?.textContent ===
        "orbit",
    );
  for (let step = 0; step < 4 && orbitDesks().length < 100; step += 1) {
    const before = orbitDesks().length;
    const expand = room()?.querySelector<HTMLButtonElement>(
      '.town-fold-tile[aria-label^="Show "]',
    );
    if (!expand) throw new Error("the slow-frame room lost its Expand tile");
    tapTownControl(expand);
    await waitFor(
      () =>
        orbitDesks().length > before &&
        host.querySelector(
          '.world-semantic-targets-overlay[aria-busy="false"]',
        ) !== null,
      "the slow-frame room did not finish admitting its next desks",
    );
    check(
      orbitDesks().length - before <= 20,
      "the slow-frame room revealed more than 20 desks per click",
    );
  }
  check(orbitDesks().length === 100, "the slow-frame room must show 100 desks");

  const orbitCard = () =>
    [...host.querySelectorAll<HTMLButtonElement>(".town-room-card")].find(
      (card) => card.textContent?.includes("orbit"),
    );
  await prepareTownRoomCard(host, diagnostics, waitFor);
  await waitFor(() => !!orbitCard(), "the expanded room has no overview card");
  const beforeEntry = diagnostics.frames;
  orbitCard()!.click();
  await waitFor(
    () => diagnostics.frames > beforeEntry && !diagnostics.flying,
    "the expanded room did not land",
  );
  for (let step = 0; step < 6 && diagnostics.level !== "desk"; step += 1) {
    const before = diagnostics.frames;
    host.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click();
    await waitFor(
      () => diagnostics.frames > before && !diagnostics.flying,
      "slow-frame desk entry did not finish",
    );
  }
  check(diagnostics.level === "desk", "slow-frame entry must reach desk level");
  check(
    host.querySelector(".town-room-card") === null,
    "slow-frame entry must start without an overview card",
  );

  const actualRAF = window.requestAnimationFrame.bind(window);
  let delayedFrames = 0;
  window.requestAnimationFrame = (callback) =>
    actualRAF(() => {
      setTimeout(() => {
        delayedFrames += 1;
        callback(performance.now());
      }, frameDelay);
    });
  try {
    await prepareTownRoomCard(host, diagnostics, waitFor);
    await waitFor(
      () => !!orbitCard(),
      "slow frames never exposed the room card",
    );
  } finally {
    window.requestAnimationFrame = actualRAF;
  }
  check(delayedFrames > 0, "the slow-frame flight must draw delayed frames");
  check(!diagnostics.flying, "the slow-frame zoom-out flight must land");
  const beforeReturn = diagnostics.frames;
  orbitCard()!.click();
  await waitFor(() => {
    const first = targets().find(
      (target) =>
        JSON.parse(target.dataset.targetKey!)[2] === "local-orbit-tab-0",
    );
    const box = first?.getBoundingClientRect();
    return (
      diagnostics.frames > beforeReturn &&
      !diagnostics.flying &&
      !!box &&
      box.width > 0 &&
      box.top >= 0 &&
      box.left >= 0 &&
      box.bottom <= window.innerHeight &&
      box.right <= window.innerWidth
    );
  }, "the slow-frame room card did not land on its first desk");
  check(
    targets().some(
      (target) =>
        JSON.parse(target.dataset.targetKey!)[2] === "local-orbit-tab-99",
    ),
    "the slow-frame room's newest desk has no target",
  );
  check(
    diagnostics.lastError === null,
    `renderer error: ${diagnostics.lastError}`,
  );
}
