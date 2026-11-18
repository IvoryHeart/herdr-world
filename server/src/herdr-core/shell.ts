/**
 * Enter the account shell on the core host, where its rc files add tools.
 * Like core's plain terminals, only macOS uses a login shell. World never
 * captures the environment: the shell resolves it and execs the program.
 * Positional arguments keep profile arguments and prompts out of shell code.
 */
const ENTER_SHELL = [
  "shell=${SHELL:-/bin/sh}",
  'flags=-ic; [ "$(uname -s)" != Darwin ] || flags=-lic',
  'case "${shell##*/}" in',
  'fish) exec "$shell" "$flags" \'exec $argv\' "$@" ;;',
  '*) exec "$shell" "$flags" \'exec "$@"\' world-agent "$@" ;;',
  "esac",
].join("\n");

/** Windows keeps native launching; Unix bypasses core templates with /bin/sh. */
export function coreShellArgv(argv: string[]): string[] {
  return argv[0]?.startsWith("/")
    ? ["/bin/sh", "-c", ENTER_SHELL, "world-agent", ...argv]
    : argv;
}
