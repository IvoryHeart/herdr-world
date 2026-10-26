import type { TownRendererDiagnostics } from "./townDiagnostics";

/** Establish the browser scenario's overview/card precondition using real controls. */
export async function prepareTownRoomCard(
  host: Pick<HTMLElement, "querySelector">,
  diagnostics: Pick<
    TownRendererDiagnostics,
    "frames" | "flying" | "level" | "zoom"
  >,
  waitFor: (
    condition: () => boolean,
    message: string | (() => string),
  ) => Promise<void>,
) {
  // A settled calm/reduced-motion renderer owes no additional frame.
  await waitFor(
    () => !diagnostics.flying,
    "pre-card camera flight did not finish",
  );
  for (let step = 0; step < 6 && diagnostics.level !== "overview"; step += 1) {
    const before = diagnostics.frames;
    const zoomOut = host.querySelector<HTMLButtonElement>(
      '[aria-label="Zoom out"]',
    );
    if (!zoomOut) throw new Error("room-card setup has no Zoom out control");
    zoomOut.click();
    await waitFor(
      () => diagnostics.frames > before && !diagnostics.flying,
      "room-card setup zoom-out flight did not finish",
    );
  }
  await waitFor(
    () =>
      diagnostics.level === "overview" &&
      host.querySelector(".town-room-card") !== null,
    () =>
      `room-card setup never reached a mounted overview card (level ${diagnostics.level}, zoom ${diagnostics.zoom.toFixed(2)})`,
  );
}
