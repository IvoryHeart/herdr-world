/**
 * A model's context window in tokens, for the context bar (docs/usage.md).
 * A window the harness reported wins (Codex logs its own). Otherwise a small
 * table by model name; an unknown or ambiguous model has no window, so no bar.
 */
export function contextWindowTokens(
  model: string,
  reported: number | null = null,
): number | null {
  if (reported !== null) return reported;
  const claude =
    /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-|$)/.exec(model);
  if (claude) {
    const [, family, major, minor] = claude;
    const version = Number(major) * 100 + Number(minor ?? 0);
    // Native one-million windows, as Claude Code's model configuration has them.
    if (
      family === "fable" ||
      (family === "opus" && version >= 407) ||
      (family === "sonnet" && version >= 500) ||
      (family === "haiku" && version >= 505)
    )
      return 1_000_000;
    // Sonnet 4.x and Opus 4.6 also run as an opt-in one-million variant
    // ("[1m]") that the transcript does not record, so the window is unknown.
    if (
      (family === "sonnet" && version >= 400) ||
      (family === "opus" && version === 406)
    )
      return null;
    if (version >= 400 && version < 500) return 200_000;
    return null;
  }
  if (/^claude-3/.test(model)) return 200_000;
  if (/^gemini-(?:2\.5|3)(?:\.\d+)?-/.test(model)) return 1_048_576;
  return null;
}
