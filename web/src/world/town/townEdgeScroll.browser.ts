/** Phone carry setup and observable cross-room edge-scroll checks. */
export async function prepareTownEdgeDrop({
  host,
  canvasHost,
  fromDesk,
  press,
  waitFor,
  frameDelay,
  workspaceIdForName,
}: {
  host: HTMLElement;
  canvasHost: HTMLElement;
  fromDesk: HTMLElement;
  press: (type: string, point: readonly [number, number]) => void;
  waitFor: (
    condition: () => boolean,
    message: string | (() => string),
  ) => Promise<void>;
  frameDelay: number;
  workspaceIdForName: (
    connectionId: string,
    name: string,
  ) => string | undefined;
}) {
  const renderer = window.__HERDR_TOWN_RENDERER__!;
  const [connection, generation, tab] = JSON.parse(
    fromDesk.dataset.targetKey!,
  ) as [string, number, string];
  const workspace = tab.replace(/-tab-\d+$/, "");
  const roomName = fromDesk.getAttribute("aria-label")!.split(",")[1]!.trim();
  // Labels locate synthetic geometry only. Drag/drop ownership below is checked
  // against connection/generation/native keys, never an agent display label.
  const room = [...host.querySelectorAll<HTMLElement>(".town-room")].find(
    (node) =>
      node.querySelector(".town-room-plaque-name")?.textContent === roomName,
  );
  if (!room)
    throw new Error(`edge-scroll setup has no source room ${roomName}`);
  const building = room.closest(".town-building-layer")!;
  const stage = canvasHost.getBoundingClientRect();
  await waitFor(
    () => !renderer.flying,
    "edge-scroll setup camera flight did not finish",
  );
  // Each arrow key pans 60 screen pixels. Batch the ordinary key presses,
  // then wait for their state frame. Keep the room boundary below the screen
  // so the held edge scroll, rather than setup, must reveal the destination.
  const steps = Math.ceil(
    (room.getBoundingClientRect().bottom - stage.bottom - 80) / 60,
  );
  if (steps) {
    const before = renderer.frames;
    for (let step = 0; step < Math.abs(steps); step += 1)
      canvasHost.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: steps > 0 ? "ArrowDown" : "ArrowUp",
          bubbles: true,
        }),
      );
    await waitFor(
      () => renderer.frames > before && !renderer.flying,
      "edge-scroll setup pan never rendered",
    );
  }
  const safe = ([x, y]: readonly [number, number]) =>
    x > stage.left + 80 &&
    x < stage.right - 80 &&
    y > stage.top + 80 &&
    y < stage.bottom - 100;
  const center = (node: HTMLElement) => {
    const box = node.getBoundingClientRect();
    return [box.left + box.width / 2, box.top + box.height / 2] as const;
  };
  const source = [
    ...host.querySelectorAll<HTMLElement>(
      '.world-semantic-target[data-kind="desk"]',
    ),
  ]
    .filter((node) => {
      const [c, g, native] = JSON.parse(node.dataset.targetKey!);
      return (
        c === connection &&
        g === generation &&
        native.replace(/-tab-\d+$/, "") === workspace &&
        safe(center(node))
      );
    })
    .sort((a, b) => center(b)[1] - center(a)[1])[0];
  if (!source)
    throw new Error(
      "edge-scroll setup has no visible desk near the room boundary",
    );
  const destination = () =>
    [...building.querySelectorAll<HTMLElement>(".town-room")]
      .map((node) => {
        const name =
          node.querySelector(".town-room-plaque-name")?.textContent ?? "";
        const native = workspaceIdForName(connection, name);
        const box = node.getBoundingClientRect();
        const scale = box.width / node.offsetWidth;
        return {
          native,
          point: [
            box.left + box.width / 2,
            box.top + Math.min(box.height / 2, 64 * scale),
          ] as const,
        };
      })
      .find(
        ({ native, point }) =>
          native &&
          native !== workspace &&
          point[1] > room.getBoundingClientRect().bottom &&
          safe(point),
      );
  if (destination())
    throw new Error("edge-scroll setup already shows the destination");
  const boundaryBefore = room.getBoundingClientRect().bottom;
  const ghost = () => host.querySelector<HTMLElement>(".town-drag-ghost");
  const actualRAF = window.requestAnimationFrame.bind(window);
  if (frameDelay > 0)
    window.requestAnimationFrame = (callback) =>
      actualRAF(() => {
        setTimeout(() => callback(performance.now()), frameDelay);
      });
  try {
    press("pointerdown", center(source));
    await waitFor(
      () => ghost() !== null,
      "holding the boundary desk did not lift it",
    );
    press("pointermove", [stage.left + stage.width / 2, stage.bottom - 20]);
    // While the town scrolls under the held desk, nothing rests under it, so
    // the carry must never snap to a passing desk (the group magnet).
    const snapped: string[] = [];
    const watchSnap = () => {
      if (ghost()?.dataset.action === "group")
        snapped.push(ghost()?.textContent ?? "");
    };
    // Hold continuously. A fixed 250ms pulse can end before a slow RAF runs.
    await waitFor(
      () => {
        watchSnap();
        return destination() !== undefined;
      },
      () =>
        `edge hold never revealed a safe destination (frames ${renderer.frames}, ghost ${ghost()?.textContent}, boundary ${room.getBoundingClientRect().bottom.toFixed(1)})`,
    );
    if (snapped.length)
      throw new Error(
        `the carry snapped to a desk scrolling under it at the edge (${snapped[0]})`,
      );
    const target = destination()!;
    press("pointermove", target.point);
    await waitFor(
      () =>
        ghost()?.dataset.valid === "true" && ghost()?.dataset.action === "move",
      () =>
        `the edge-revealed room is not a valid cross-room drop target (ghost ${JSON.stringify({ text: ghost()?.textContent ?? null, valid: ghost()?.dataset.valid, action: ghost()?.dataset.action })}, point ${target.point.map((v) => v.toFixed(1)).join(",")}, room ${target.native}, frames ${renderer.frames}, flying ${renderer.flying}, zoom ${renderer.zoom.toFixed(3)})`,
    );
    if (room.getBoundingClientRect().bottom >= boundaryBefore)
      throw new Error("holding a desk at the edge did not scroll the room");
    return {
      point: target.point,
      workspace: target.native!,
      connection,
      tab: JSON.parse(source.dataset.targetKey!)[2] as string,
    };
  } finally {
    window.requestAnimationFrame = actualRAF;
  }
}
