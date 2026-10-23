/** Shape checks for a terminal popup pushed by the bridge (api.ts). */
function isValidPopupSize(value: unknown): boolean {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const size = value as Record<string, unknown>;
  return (
    (size.kind === "cells" || size.kind === "percent") &&
    typeof size.value === "number"
  );
}

export function isValidPopupPayload(value: unknown): boolean {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const popup = value as Record<string, unknown>;
  return (
    typeof popup.terminal_id === "string" &&
    popup.terminal_id.length > 0 &&
    typeof popup.title === "string" &&
    isValidPopupSize(popup.width) &&
    isValidPopupSize(popup.height)
  );
}
