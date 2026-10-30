import { prepareTownRoomCard } from "./townRoomCard.browser";

/**
 * Pod plaques in the real Town scene: three adjacent pull requests, one with
 * an earlier round stacked, each plaque within its own wall at the scale the
 * room shows and at the largest scale zoomed out.
 */
export async function checkTownPodPlaques(
  host: HTMLElement,
  check: (condition: boolean, message: string) => void,
  waitFor: (
    condition: () => boolean,
    message: string | (() => string),
  ) => Promise<void>,
) {
  const renderer = window.__HERDR_TOWN_RENDERER__!;
  await prepareTownRoomCard(host, renderer, waitFor);
  const card = [
    ...host.querySelectorAll<HTMLButtonElement>(".town-room-card"),
  ].find((candidate) => candidate.textContent?.includes("pods-room"));
  check(card !== undefined, "the pods room has no overview card");
  if (!card) return;
  const before = renderer.frames;
  card.click();
  await waitFor(
    () =>
      renderer.frames > before &&
      !renderer.flying &&
      renderer.level !== "overview",
    "pods room focus never settled",
  );
  const plaques = () => [
    ...host.querySelectorAll<HTMLElement>(".town-pod-plaque"),
  ];
  await waitFor(
    () => plaques().length === 3,
    () => `expected 3 pod plaques, found ${plaques().length}`,
  );
  check(
    plaques().some((plaque) =>
      plaque.getAttribute("aria-label")?.includes("r2 · +1 earlier"),
    ),
    "#512's earlier round is not stacked behind its current round",
  );
  const layer = host.querySelector<HTMLElement>(".town-world")!;
  const z = Number(layer.style.getPropertyValue("--z"));
  const shown = layer.style.getPropertyValue("--iz");
  const level = layer.dataset.level!;
  check(level === "desk", `the pods room settled at level ${level}`);
  for (const iz of [shown, "1.6"]) {
    // Measured in one task, before the renderer's next frame resets it; the
    // largest scale is the room level's, zoomed out.
    layer.style.setProperty("--iz", iz);
    layer.dataset.level = iz === shown ? level : "room";
    const boxes = plaques().map((plaque) => {
      const at = plaque.parentElement!;
      const { left, top: edge } = at.getBoundingClientRect();
      const wall = Number.parseFloat(at.style.getPropertyValue("--wall-w"));
      return {
        plaque,
        label: plaque.getAttribute("aria-label"),
        box: plaque.getBoundingClientRect(),
        number: plaque.children[1]!.getBoundingClientRect(),
        left,
        right: left + wall * z,
        edge,
      };
    });
    for (const { plaque, label, box, number, left, right, edge } of boxes) {
      if (iz === shown)
        check(
          box.bottom <= edge + 0.5,
          `${label}: plaque bottom ${box.bottom.toFixed(1)} is below its wall's edge ${edge.toFixed(1)}`,
        );
      check(
        plaque.scrollWidth <= plaque.clientWidth + 1,
        `${label}: content overflows the plaque at --iz ${iz}`,
      );
      check(
        box.left >= left - 0.5 && box.right <= right + 0.5,
        `${label}: plaque ${box.left.toFixed(1)}–${box.right.toFixed(1)} leaves its wall ${left.toFixed(1)}–${right.toFixed(1)} at --iz ${iz}`,
      );
      check(
        number.width > 0 && number.right <= box.right + 0.5,
        `${label}: the pull request number is cut off at --iz ${iz}`,
      );
    }
    // Clear of the tables' own tags; seat labels show only when zoomed in.
    const names = [
      ...host.querySelectorAll<HTMLElement>(
        `.town-desk-name, .town-desk-badge, .town-desk-more${iz === shown ? ", .town-seat-tag" : ""}`,
      ),
    ]
      .filter((tag) => !tag.closest(".town-pod-plaque"))
      .map((tag) => tag.getBoundingClientRect());
    for (const { label, box } of boxes) {
      const covered = names.find(
        (name) =>
          name.right > box.left &&
          box.right > name.left &&
          name.bottom > box.top &&
          box.bottom > name.top,
      );
      check(
        !covered,
        `${label} (${box.top.toFixed(1)}–${box.bottom.toFixed(1)}) covers a table's tag (${covered?.top.toFixed(1)}–${covered?.bottom.toFixed(1)}) at --iz ${iz}, z ${z}`,
      );
    }
    for (const [index, a] of boxes.entries())
      for (const b of boxes.slice(index + 1))
        check(
          a.box.right <= b.box.left ||
            b.box.right <= a.box.left ||
            a.box.bottom <= b.box.top ||
            b.box.bottom <= a.box.top,
          `${a.label} overlaps ${b.label} at --iz ${iz}`,
        );
  }
  layer.style.setProperty("--iz", shown);
  layer.dataset.level = level;
}
