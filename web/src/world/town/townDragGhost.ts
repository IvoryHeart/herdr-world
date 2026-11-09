/**
 * The label that follows a carried desk, agent or room over the canvas
 * (TownInteraction's ghost port): shown on lift, aimed as it moves.
 */
export function townDragGhost(host: HTMLElement) {
  const ghost = document.createElement("div");
  ghost.className = "town-drag-ghost";
  ghost.setAttribute("aria-hidden", "true");
  const place = (at: { x: number; y: number }) => {
    ghost.style.transform = `translate(${at.x}px, ${at.y}px)`;
  };
  return {
    lift(label: string, at: { x: number; y: number }) {
      ghost.textContent = label;
      ghost.dataset.valid = "false";
      place(at);
      host.append(ghost);
    },
    aim(
      label: string,
      valid: boolean,
      action: string,
      at: { x: number; y: number },
    ) {
      ghost.textContent = label;
      ghost.dataset.valid = String(valid);
      ghost.dataset.action = action;
      place(at);
    },
    remove: () => ghost.remove(),
  };
}
