import { SERVER_FLAGS } from "../config/server-config";
import {
  type CliCommand,
  EXIT_OK,
  parseCommandArgs,
  UsageError,
  wantsHelp,
} from "./command";

const SHELLS = ["bash", "zsh", "fish"] as const;
type Shell = (typeof SHELLS)[number];

function completionHelp(): string {
  return `Print a shell completion script.

Usage:
  herdr-world completion <bash|zsh|fish>

Install it with one of:
  bash: herdr-world completion bash > ~/.local/share/bash-completion/completions/herdr-world
  zsh:  herdr-world completion zsh > "\${fpath[1]}/_herdr-world"
        (or add \`source <(herdr-world completion zsh)\` to ~/.zshrc)
  fish: herdr-world completion fish > ~/.config/fish/completions/herdr-world.fish
`;
}

/** Words offered after `herdr-world <command>`. */
function commandWords(command: CliCommand): string[] {
  return [...(command.actions ?? []), ...(command.flags ?? []), "--help"];
}

function shellWords(words: readonly string[]): string {
  // Completion words are fixed identifiers and flags; reject anything a shell
  // could interpret rather than quoting it.
  for (const word of words) {
    if (!/^[A-Za-z0-9-]+$/.test(word))
      throw new Error(`invalid completion word: ${word}`);
  }
  return words.join(" ");
}

export function renderCompletion(
  shell: Shell,
  commands: readonly CliCommand[],
): string {
  const topLevel = [
    ...commands.map((command) => command.name),
    ...SERVER_FLAGS,
  ];
  if (shell === "bash") {
    const cases = commands
      .map(
        (command) =>
          `    ${command.name}) words="${shellWords(commandWords(command))}" ;;`,
      )
      .join("\n");
    return `# herdr-world bash completion
_herdr-world() {
  local cur words
  cur="\${COMP_WORDS[COMP_CWORD]}"
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=($(compgen -W "${shellWords(topLevel)}" -- "$cur"))
    return
  fi
  case "\${COMP_WORDS[1]}" in
${cases}
    *) words="" ;;
  esac
  COMPREPLY=($(compgen -W "$words" -- "$cur"))
}
complete -o default -F _herdr-world herdr-world
`;
  }
  if (shell === "zsh") {
    const cases = commands
      .map(
        (command) =>
          `    ${command.name}) compadd -- ${shellWords(commandWords(command))} ;;`,
      )
      .join("\n");
    return `#compdef herdr-world
# herdr-world zsh completion
_herdr-world() {
  if (( CURRENT == 2 )); then
    compadd -- ${shellWords(topLevel)}
    return
  fi
  case "$words[2]" in
${cases}
    *) _files ;;
  esac
}
if [ "$funcstack[1]" = "_herdr-world" ]; then
  _herdr-world "$@"
else
  compdef _herdr-world herdr-world
fi
`;
  }
  const lines = [
    "# herdr-world fish completion",
    "complete -c herdr-world -f",
    ...SERVER_FLAGS.map(
      (flag) =>
        `complete -c herdr-world -n __fish_use_subcommand -l ${shellWords([flag.slice(2)])}`,
    ),
  ];
  for (const command of commands) {
    const summary = command.summary.replaceAll("'", "");
    lines.push(
      `complete -c herdr-world -n __fish_use_subcommand -a ${shellWords([command.name])} -d '${summary}'`,
    );
    const condition = `'__fish_seen_subcommand_from ${command.name}'`;
    if (command.actions?.length)
      lines.push(
        `complete -c herdr-world -n ${condition} -a '${shellWords(command.actions)}'`,
      );
    for (const flag of [...(command.flags ?? []), "--help"])
      lines.push(
        `complete -c herdr-world -n ${condition} -l ${shellWords([flag.slice(2)])}`,
      );
  }
  return `${lines.join("\n")}\n`;
}

export function createCompletionCommand(
  commands: () => readonly CliCommand[],
): CliCommand {
  return {
    name: "completion",
    summary: "print a bash, zsh or fish completion script",
    actions: SHELLS,
    help: completionHelp,
    async run(args, context) {
      if (wantsHelp(args) || args.length === 0) {
        context.log(completionHelp());
        return EXIT_OK;
      }
      const { positionals } = parseCommandArgs(args, {}, 1);
      const shell = positionals[0] as Shell;
      if (!SHELLS.includes(shell))
        throw new UsageError(
          `unsupported shell: ${positionals[0]} (expected bash, zsh or fish)`,
        );
      context.log(renderCompletion(shell, commands()).trimEnd());
      return EXIT_OK;
    },
  };
}
