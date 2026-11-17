/** Ignore animated status glyphs even when a harness puts text before them. */
export function withoutTitleSpinner(title: string): string {
  return title
    .replace(/[\u2800-\u28ff✳✶✻✽✢◐◓◑◒⏺]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}
