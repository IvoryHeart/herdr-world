// Shared by the server's conversation readers and the browser's open rule, so
// it must stay free of Node or browser imports.

/** Harnesses with a transcript reader; Herdr can detect more than these. */
export const SESSION_AGENTS: ReadonlySet<string> = new Set([
  "codex",
  "claude",
  "kimi",
  "grok",
  "pi",
  "muse",
  "agy",
]);

export function normalizeAgentName(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "pi-agent" || normalized === "pi-coding-agent")
    return "pi";
  if (normalized === "claude-code") return "claude";
  if (normalized === "muse-code" || normalized === "muse code") return "muse";
  if (normalized === "kimi-code" || normalized === "kimi code") return "kimi";
  if (normalized === "grok-build" || normalized === "grok build") return "grok";
  if (
    normalized === "antigravity" ||
    normalized === "antigravity-cli" ||
    normalized === "antigravity cli"
  ) {
    return "agy";
  }
  return normalized;
}
