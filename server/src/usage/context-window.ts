/**
 * A model's context window in tokens, for the context bar (docs/usage.md).
 * A window the harness reported wins (Codex logs its own). Otherwise a small
 * table by model name; an unknown model has no window, so no bar.
 */
export function contextWindowTokens(
  model: string,
  used: number,
  reported: number | null = null,
): number | null {
  if (reported !== null) return reported;
  const claude =
    /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-|$)/.exec(model);
  if (claude) {
    const [, family, major, minor] = claude;
    const version = Number(major) * 100 + Number(minor ?? 0);
    // Native one-million windows, as Claude Code's own model table has them.
    if (
      family === "fable" ||
      (family === "opus" && version >= 407) ||
      (family === "sonnet" && version >= 500)
    )
      return 1_000_000;
    if (family === "haiku" && version >= 500) return null;
    // 200k by default. The transcript does not record the opt-in 1M
    // variant, so a prompt already past 200k must be running on it.
    return used > 200_000 ? 1_000_000 : 200_000;
  }
  if (/^claude-3/.test(model)) return 200_000;
  if (/^gemini-(?:2\.5|3)(?:\.\d+)?-/.test(model)) return 1_048_576;
  return null;
}
