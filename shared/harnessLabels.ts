/**
 * Each harness's full product name, keyed by Herdr's agent id: what
 * Integrations lists and what World's search matches ("Claude Code" finds a
 * Claude agent, #1329).
 */
export const HARNESS_LABELS: Readonly<Record<string, string>> = {
  claude: "Claude Code",
  codex: "Codex",
  pi: "Pi",
  omp: "Oh My Pi",
  copilot: "GitHub Copilot",
  devin: "Devin",
  droid: "Droid",
  kimi: "Kimi Code",
  opencode: "OpenCode",
  kilo: "Kilo Code",
  hermes: "Hermes",
  qodercli: "Qoder",
  qwen: "Qwen Code",
  letta: "Letta",
  cursor: "Cursor",
  mastracode: "Mastra Code",
  "antigravity-cli": "Antigravity",
  grok: "Grok",
};
