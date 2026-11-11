import { WORLD_HARNESSES } from "../cli/harness-names";

/**
 * Agent harnesses as World names them, with the other names herdr-core
 * programs report (OSC 7501 `app=`) or run as. The union of Herdr's
 * integration names and the agents Herdr's desktop app ships
 * (`defaults/programs.json`): every harness either runtime supports.
 */
const ALIASES: Record<string, readonly string[]> = {
  claude: ["claude-code"],
  cursor: ["cursor-agent"],
  copilot: ["github-copilot"],
  grok: ["grok-build"],
  "antigravity-cli": ["antigravity", "agy"],
  kimi: ["kimi-code", "kimicodecli"],
  kiro: ["kiro-cli"],
  qodercli: ["qoder"],
  pi: ["pi-agent", "pi-coding-agent"],
  hermes: ["hermes-agent"],
};
/** Agents Herdr's desktop app lists that are not Herdr integrations. */
const APP_AGENTS = [
  "pig",
  "amp",
  "dsh-tui",
  "muse",
  "crush",
  "command-code",
  "prime-agent",
  "gemini",
  "ollama",
] as const;

const NAMES = new Map<string, string>();
for (const name of [...WORLD_HARNESSES, ...APP_AGENTS, ...Object.keys(ALIASES)])
  NAMES.set(name, name);
for (const [name, aliases] of Object.entries(ALIASES))
  for (const alias of aliases) NAMES.set(alias, name);

/** Shells and launchers the desktop app looks through (`programs.json`). */
const SHELLS = new Set(
  "zsh bash fish sh dash nu pwsh powershell cmd elvish xonsh tcsh csh ksh ion".split(
    " ",
  ),
);
const INTERPRETERS = new Set(
  "node bun bunx deno python python3 npx pnpm yarn uv uvx ruby bundle env sudo nice time watch nodemon".split(
    " ",
  ),
);

function base(value: string): string {
  return (
    value
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.exe$/i, "")
      .toLowerCase() ?? ""
  );
}

/** World's name for a harness, or null when `name` names none. */
export function harnessName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  return NAMES.get(base(name.trim())) ?? null;
}

/**
 * The harness a command line runs, looking through the user's shell wrapper
 * (`zsh -ic '"$@"; exec "$0" -i' zsh claude`) and script interpreters
 * (`node …/codex.js`), as Herdr's desktop app does.
 */
export function harnessOfArgv(argv: unknown, depth = 0): string | null {
  if (!Array.isArray(argv) || depth > 2) return null;
  const words = argv.filter((word): word is string => typeof word === "string");
  const first = words[0];
  if (!first) return null;
  const program = base(first);
  if (
    SHELLS.has(program) &&
    words.length > 4 &&
    words[1]?.startsWith("-") &&
    words[1].endsWith("c") &&
    words[2]?.includes('"$@"')
  )
    return harnessOfArgv(words.slice(4), depth + 1);
  if (INTERPRETERS.has(program)) {
    for (const word of words.slice(1)) {
      if (word.startsWith("-")) continue;
      const found = harnessName(word.replace(/\.(?:[cm]?js|ts|py|rb)$/, ""));
      if (found) return found;
    }
    return null;
  }
  return harnessName(program);
}

/** Every harness World recognises in core (Herdr's and the desktop app's). */
export function coreHarnessNames(): string[] {
  return [...new Set(NAMES.values())];
}
