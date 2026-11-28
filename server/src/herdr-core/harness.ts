import { WORLD_HARNESSES } from "../cli/harness-names";

/**
 * Agent harnesses as World names them, with the other names herdr-core
 * programs report (OSC 7501 `app=`) or run as. The union of Herdr's
 * integration/detection names and the agents Herdr's desktop app ships
 * (`defaults/programs.json`): every harness either runtime supports.
 */
const ALIASES: Record<string, readonly string[]> = {
  claude: ["claude-code"],
  omp: ["oh-my-pi"],
  kilo: ["kilo-code"],
  cursor: ["cursor-agent"],
  copilot: ["github-copilot"],
  grok: ["grok-build"],
  "antigravity-cli": ["antigravity", "agy"],
  kimi: ["kimi-code", "kimicodecli"],
  kiro: ["kiro-cli"],
  qodercli: ["qoder", "qoderclicn", "qodercn"],
  pi: ["pi-agent", "pi-coding-agent"],
  hermes: ["hermes-agent"],
  muse: ["muse-code"],
};
/** Detection/desktop harnesses outside World's integration-name list. */
const EXTRA_HARNESSES = [
  "cline",
  "maki",
  "kiro",
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
for (const name of [
  ...WORLD_HARNESSES,
  ...EXTRA_HARNESSES,
  ...Object.keys(ALIASES),
])
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
 * How each harness is told to run one task and exit (headless): a flag, or a
 * subcommand. Such a run exists only while it works, so a live headless
 * process is a working agent even when it reports no status.
 *
 * A subcommand counts only as the first plain word that is no option's
 * value (`codex -C exec` runs interactive Codex in a folder named `exec`).
 * `values` take one value, `lists` take values up to the next option, and
 * `switches` take none; after any other option the next word may be its
 * value, so it never proves a headless run.
 */
type HeadlessRule = {
  flags?: readonly string[];
  commands?: readonly string[];
  values?: readonly string[];
  lists?: readonly string[];
  switches?: readonly string[];
};
const HEADLESS: Record<string, HeadlessRule> = {
  claude: { flags: ["-p", "--print"] },
  codex: {
    commands: ["exec", "e"],
    // `codex --help` (0.1x): the options its top level takes before a subcommand.
    values: [
      "-c",
      "--config",
      "--enable",
      "--disable",
      "--remote",
      "--remote-auth-token-env",
      "-m",
      "--model",
      "--local-provider",
      "-p",
      "--profile",
      "-s",
      "--sandbox",
      "-C",
      "--cd",
      "--add-dir",
      "-a",
      "--ask-for-approval",
    ],
    lists: ["-i", "--image"],
    switches: [
      "--strict-config",
      "--oss",
      "--approve-for-me",
      "--full-auto",
      "--dangerously-bypass-approvals-and-sandbox",
      "--dangerously-bypass-hook-trust",
      "--worktree",
      "--search",
      "--no-alt-screen",
      "--no-daemon",
    ],
  },
  gemini: { flags: ["-p", "--prompt"] },
  qwen: { flags: ["-p", "--prompt"] },
  cursor: { flags: ["-p", "--print"] },
  copilot: { flags: ["-p", "--prompt"] },
  pi: { flags: ["-p", "--print"] },
  amp: { flags: ["-x", "--execute"] },
  opencode: { commands: ["run"] },
  crush: { commands: ["run"] },
  droid: { commands: ["exec"] },
};

function headless(harness: string, args: readonly string[]): boolean {
  const rule = HEADLESS[harness];
  if (!rule) return false;
  const end = args.indexOf("--");
  const words = end < 0 ? args : args.slice(0, end);
  if (rule.flags)
    return words.some((word) =>
      rule.flags!.some(
        (flag) =>
          word === flag ||
          (flag.startsWith("--") && word.startsWith(`${flag}=`)),
      ),
    );
  // What the word after the last option is: its value, one of its values,
  // perhaps its value (an option this list does not know), or free.
  let after: "value" | "list" | "unknown" | null = null;
  for (const word of words) {
    if (word.startsWith("-") && word.length > 1) {
      const long = word.startsWith("--");
      const option = long ? word.split("=")[0]! : word.slice(0, 2);
      const inline = long ? word.includes("=") : word.length > 2;
      if (rule.switches?.includes(option)) after = null;
      else if (rule.lists?.includes(option)) after = "list";
      else if (rule.values?.includes(option)) after = inline ? null : "value";
      else after = inline ? null : "unknown";
      continue;
    }
    if (after === "value") {
      after = null;
      continue;
    }
    if (after === "list") continue;
    // A word that may be an unknown option's value proves nothing.
    if (after === "unknown") return false;
    return rule.commands?.includes(word) ?? false;
  }
  return false;
}

/** A harness command line: which harness, and whether it runs headless. */
export type HarnessInvocation = { harness: string; headless: boolean };

/**
 * The harness a command line runs, looking through the user's shell wrapper
 * (`zsh -ic '"$@"; exec "$0" -i' zsh claude`) and script interpreters
 * (`node …/codex.js`), as Herdr's desktop app does, and whether it runs one
 * task headless (`claude -p`, `codex exec`).
 */
export function harnessInvocation(
  argv: unknown,
  depth = 0,
): HarnessInvocation | null {
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
    return harnessInvocation(words.slice(4), depth + 1);
  const found = (harness: string | null, at: number) =>
    harness
      ? { harness, headless: headless(harness, words.slice(at + 1)) }
      : null;
  if (INTERPRETERS.has(program)) {
    for (const [i, word] of words.entries()) {
      if (i === 0 || word.startsWith("-")) continue;
      const invocation = found(
        harnessName(word.replace(/\.(?:[cm]?js|ts|py|rb)$/, "")),
        i,
      );
      if (invocation) return invocation;
    }
    return null;
  }
  return found(harnessName(program), 0);
}

/** The harness a command line runs (see `harnessInvocation`). */
export function harnessOfArgv(argv: unknown): string | null {
  return harnessInvocation(argv)?.harness ?? null;
}

/**
 * Whether a foreground program could be running a harness out of sight: a
 * shell or interpreter leading its process group (`bash run.sh`,
 * `sh -c "claude …"`) can have the harness as a member of that group. The
 * terminal's own interactive shell cannot: its jobs get their own groups
 * (job control), and core clears a program's report when one is back in
 * front (its `shell_root` rule, matched here). A subshell that kept the
 * interactive shell's argv can: a shell function or alias in a pipeline
 * (`f | cat`) leads its job as a forked copy of the shell, told apart by a
 * pid other than the terminal's own (`root`).
 */
export function mayWrapHarness(
  foreground: { name?: unknown; argv?: unknown; pid?: unknown },
  root?: unknown,
): boolean {
  const argv = Array.isArray(foreground.argv) ? foreground.argv : [];
  const names = [argv[0], foreground.name].filter(
    (name): name is string => typeof name === "string",
  );
  const shell = names.some((name) => SHELLS.has(base(name)));
  if (!shell) return names.some((name) => INTERPRETERS.has(base(name)));
  if (
    typeof root === "number" &&
    typeof foreground.pid === "number" &&
    foreground.pid !== root
  )
    return true;
  return argv
    .slice(1)
    .some(
      (arg) =>
        typeof arg !== "string" ||
        (!arg.startsWith("-") && !arg.startsWith("+")) ||
        /^--commands?(=|$)/.test(arg) ||
        (/^-[^-]/.test(arg) && arg.slice(1).includes("c")),
    );
}

/**
 * An interactive shell alone in front, waiting for a command: a plain
 * terminal with nothing unfinished. A shell running a script or `-c`, or any
 * other program (`sleep 3600` as the terminal's own program), is busy.
 */
export function isIdleShell(
  foreground: { name?: unknown; argv?: unknown; pid?: unknown },
  root?: unknown,
): boolean {
  const argv = Array.isArray(foreground.argv) ? foreground.argv : [];
  const names = [argv[0], foreground.name].filter(
    (name): name is string => typeof name === "string",
  );
  // A login shell's argv[0] starts with "-" (`-bash`).
  return (
    names.some((name) => SHELLS.has(base(name).replace(/^-/, ""))) &&
    !mayWrapHarness(foreground, root)
  );
}

/** Every harness World recognises in core (Herdr's and the desktop app's). */
export function coreHarnessNames(): string[] {
  return [...new Set(NAMES.values())];
}
