/**
 * The owner's last sighting across every browser (world.presence.seen), so a
 * return after time away is judged by all devices, not one. It is kept in
 * memory: after a service restart each browser's own last seen decides.
 */
export class OwnerPresenceClock {
  #lastSeen: number | null = null;

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Record a sighting now; the previous one, both by the service's clock. */
  seen() {
    const now = this.now();
    const previous = this.#lastSeen;
    this.#lastSeen = Math.max(previous ?? now, now);
    return { previous, now };
  }
}

export const ownerPresence = new OwnerPresenceClock();
