import { createHash } from "node:crypto";
import { sshCommandArgv } from "../bridge/ssh-command";
import { shQuote } from "../utils/process-utils";
import type { RunProcessWithCodeTimeout } from "../workspace/file-types";
import { claudeTapArgs, type ClaudeTapRuntime } from "./claude-tap";

/**
 * TUI agent.start types its argv into a shell. Inline tap JSON exceeds a
 * canonical terminal's line limit before the closing quote. Write that JSON
 * over a non-PTY process instead; Claude accepts a settings file as well.
 * Only World-generated tap settings are cached, never a profile or user data.
 */
export async function claudeLaunchTapArgs(options: {
  runtime: ClaudeTapRuntime;
  host?: string;
  windows: boolean;
  run: RunProcessWithCodeTimeout;
}): Promise<string[]> {
  const { runtime, host, windows, run } = options;
  const args = claudeTapArgs(runtime);
  // Windows does not use Unix canonical terminal input. Preserve its launch.
  if (windows) return args;
  const settings = args[1]!;
  const hash = createHash("sha256").update(settings).digest("hex");
  const program = `const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(require('node:os').homedir(), '.cache', 'herdr-world', 'claude-launch');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
if (!fs.lstatSync(dir).isDirectory()) throw new Error('invalid tap cache directory');
const file = path.join(dir, '${hash}.json');
const text = ${JSON.stringify(settings)};
const temporary = file + '.' + require('node:crypto').randomUUID() + '.tmp';
try {
  fs.writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, file);
} finally {
  try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
process.stdout.write(JSON.stringify(file));`;
  const command =
    runtime.kind === "bun"
      ? `cd / && BUN_BE_BUN=1 ${shQuote(runtime.path)} --no-env-file -e ${shQuote(program)}`
      : `cd / && ${shQuote(runtime.path)} -e ${shQuote(program)}`;
  const result = await run(
    host
      ? sshCommandArgv(host, `sh -c ${shQuote(command)}`)
      : ["/bin/sh", "-c", command],
    10_000,
  );
  if (result.code !== 0)
    throw new Error(
      "Could not prepare Claude's launch settings on this host. No agent was started.",
    );
  const file: unknown = JSON.parse(result.stdout);
  if (
    typeof file !== "string" ||
    !file.startsWith("/") ||
    /[\x00-\x1f\x7f]/.test(file)
  )
    throw new Error(
      "The host returned an invalid Claude launch settings path.",
    );
  return ["--settings", file];
}
