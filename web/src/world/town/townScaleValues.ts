/** The scene host whose usage reads "no data", never zero. */
export const TOWN_SCALE_NO_USAGE_HOST = "zephyr";

/** A stable 0–1 roll for a key and a salt (FNV-1a). */
export function townScaleRoll(key: string, salt: string): number {
  let hash = 0x811c9dc5;
  for (const char of `${salt}:${key}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash / 0x100000000;
}

/** Each synthetic room has its own appetite; desks partition its usage. */
export function townScaleDeskTokens(tabId: string) {
  const room = tabId.replace(/-t\d+$/, "");
  const appetite = 0.15 + townScaleRoll(room, "appetite") ** 2 * 2;
  const roll = townScaleRoll(tabId, "tokens");
  return roll < 0.12 ? 0 : Math.round(appetite * roll * 900_000);
}
