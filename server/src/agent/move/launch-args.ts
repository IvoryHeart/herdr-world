import { basename } from "node:path";
import { harnessName } from "../../herdr-core/harness";

type Kind = "claude" | "codex";
const words = (text: string) => new Set(text.split(/\s+/));
const VALUES = {
  claude: words(
    "--agent --agents --append-system-prompt --append-system-prompt-file --autocompact --debug-file --effort --fallback-model --json-schema --max-budget-usd --max-turns --model -n --name --permission-mode --permission-prompts --plugin-dir --plugin-url --remote-control-session-name-prefix --setting-sources --settings --system-prompt --system-prompt-file --system-prompt-snapshot",
  ),
  codex: words(
    "-a --ask-for-approval -c --config --enable --disable --local-provider -m --model -p --profile -s --sandbox --add-dir",
  ),
};
const SWITCHES = {
  claude: words(
    "--allow-dangerously-skip-permissions --ax-screen-reader --bare --brief --chrome --dangerously-skip-permissions --disable-slash-commands --exclude-dynamic-system-prompt-sections --forward-subagent-text --ide --no-chrome --restricted --safe-mode --strict-mcp-config --verbose",
  ),
  codex: words(
    "--oss --approve-for-me --dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust --full-auto --search --no-alt-screen --no-daemon --strict-config --ephemeral",
  ),
};
const MULTIPLE = words(
  "--add-dir --allowedTools --allowed-tools --betas --disallowedTools --disallowed-tools --mcp-config --tools",
);
const OPTIONAL = words("-d --debug --prompt-suggestions --remote-control");
const unreadable = () =>
  new Error(
    "World cannot safely read or reuse this agent's launch arguments. Move needs an unambiguous interactive launch command.",
  );

/** Exact argv only: a joined cmdline cannot preserve JSON, spaces or quoting. */
export function harnessLaunchArgs(
  kind: Kind,
  argv: unknown,
  depth = 0,
): string[] | null {
  if (
    !Array.isArray(argv) ||
    !argv.length ||
    depth > 2 ||
    !argv.every(
      (arg) => typeof arg === "string" && !/[\x00-\x1f\x7f]/.test(arg),
    )
  )
    return null;
  const args = argv as string[];
  const executable = basename(args[0]!);
  if (harnessName(executable) === kind) return args.slice(1);
  if (["node", "bun"].includes(executable) && args[1]) {
    const script = args[1];
    if (
      harnessName(basename(script).replace(/\.[cm]?js$/, "")) === kind ||
      (kind === "claude" && /\/claude-code\/cli\.js$/.test(script))
    )
      return args.slice(2);
  }
  if (
    ["sh", "bash", "zsh", "fish"].includes(executable) &&
    args[1]?.startsWith("-") &&
    args[1].endsWith("c") &&
    args[2]?.includes('"$@"')
  ) {
    return harnessLaunchArgs(kind, args.slice(4), depth + 1);
  }
  return null;
}

/** Keep launch policy verbatim, replacing only the old conversation selectors
 * and Codex cwd. Refuse ambiguous syntax rather than replay an initial prompt,
 * start a different command, or mistake an option's value for a selector. */
export function moveLaunchArgs(kind: Kind, argv: unknown): string[] {
  const source = harnessLaunchArgs(kind, argv);
  if (!source) throw unreadable();
  const result: string[] = [];
  let resume = false,
    resumeId = false;
  for (let i = 0; i < source.length; i++) {
    const arg = source[i]!;
    const short =
      arg.startsWith("-") && !arg.startsWith("--") && arg.length > 2
        ? arg.slice(0, 2)
        : "";
    const attached =
      VALUES[kind].has(short) ||
      (kind === "claude" && short === "-r") ||
      (kind === "codex" && short === "-C");
    const flag = attached ? short : arg.split("=", 1)[0]!;
    const inline = attached || arg.includes("=");
    if (
      kind === "claude" &&
      [
        "-r",
        "--resume",
        "--session-id",
        "--resume-session-at",
        "--from-pr",
      ].includes(flag)
    ) {
      if (!inline && source[i + 1] && !source[i + 1]!.startsWith("-")) i++;
      continue;
    }
    if (
      kind === "claude" &&
      ["-c", "--continue", "--fork-session"].includes(arg)
    )
      continue;
    if (kind === "codex") {
      if (arg === "resume" && !resume) {
        resume = true;
        continue;
      }
      if (["--last", "--all", "--include-non-interactive"].includes(arg))
        continue;
      if (["-C", "--cd"].includes(flag)) {
        if (!inline && source[++i] === undefined) throw unreadable();
        continue;
      }
      if (!arg.startsWith("-") && resume && !resumeId) {
        resumeId = true;
        continue;
      }
    }
    if (VALUES[kind].has(flag)) {
      result.push(arg);
      if (!inline) {
        if (source[i + 1] === undefined) throw unreadable();
        result.push(source[++i]!);
      }
    } else if (SWITCHES[kind].has(arg)) result.push(arg);
    else if (kind === "claude" && (MULTIPLE.has(flag) || OPTIONAL.has(flag))) {
      result.push(arg);
      if (!inline) {
        while (source[i + 1] !== undefined && !source[i + 1]!.startsWith("-")) {
          result.push(source[++i]!);
          if (OPTIONAL.has(flag)) break;
        }
      }
    } else throw unreadable();
  }
  return result;
}
