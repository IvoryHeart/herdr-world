import { sshCommandArgv } from "../bridge/ssh-command";

/**
 * Agent Skills a profile can attach: the `SKILL.md` folders on the host where
 * the workspace lives, in the repository (`.agents/skills`, `.claude/skills`)
 * and the user's harness folders. Only folder names leave the host.
 */

type Run = (
  argv: string[],
  timeoutMs: number,
) => Promise<{ code: number; stdout: string; stderr: string }>;

const SCRIPT = `for d in "$1/.agents/skills" "$1/.claude/skills" "$HOME/.agents/skills" "$HOME/.claude/skills" "$HOME/.codex/skills"; do for s in "$d"/*/SKILL.md; do [ -f "$s" ] && basename "$(dirname "$s")"; done; done; exit 0`;
const SKILL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export async function discoverSkills(options: {
  cwd: string;
  host?: string;
  /** Windows hosts have no POSIX shell to list with. */
  windows: boolean;
  run: Run;
  shQuote: (value: string) => string;
}): Promise<string[]> {
  if (options.windows) return [];
  const cwd = options.cwd || ".";
  const argv = options.host
    ? sshCommandArgv(
        options.host,
        `sh -c ${options.shQuote(SCRIPT)} sh ${options.shQuote(cwd)}`,
      )
    : ["sh", "-c", SCRIPT, "sh", cwd];
  const result = await options.run(argv, 10_000);
  if (result.code !== 0) return [];
  return [
    ...new Set(
      result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((name) => SKILL.test(name)),
    ),
  ]
    .sort()
    .slice(0, 200);
}
