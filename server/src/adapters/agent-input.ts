import { AsyncLocalStorage } from "node:async_hooks";
import type { TuiControlClient } from "./herdr-runtime";

type Row = Record<string, unknown>;
const agentInput = new AsyncLocalStorage<boolean>();

/** Server-side opt-in; explicit Terminal input retains terminal authority. */
export function withAgentInput<T>(_info: Row | null, send: () => T): T {
  return agentInput.run(true, send);
}
export function isAgentInput(): boolean {
  return agentInput.getStore() === true;
}
const row = (value: unknown): Row | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : null;
const base = (name: string) =>
  name
    .split(/[\\/]/)
    .pop()!
    .toLowerCase()
    .replace(/^-/, "")
    .replace(/\.exe$/, "");
const shells = new Set(
  "bash zsh sh fish dash ksh csh tcsh ash busybox nu pwsh powershell cmd elvish xonsh ion".split(
    " ",
  ),
);
const blocked = new Map<string, string>();
for (const [kind, names] of [
  [
    "an editor or pager",
    "vi vim nvim view nano emacs emacsclient joe pico ed ex less more most pager sensible-editor editor",
  ],
  ["ssh", "ssh mosh"],
  ["sudo or su", "sudo su doas"],
  [
    "a database client",
    "psql mysql mariadb sqlite3 redis-cli mongosh mongo sqlplus sqlcmd cqlsh",
  ],
] as const)
  for (const name of names.split(" ")) blocked.set(name, kind);

/** One policy for both runtimes, including foreground children. No agent allowlist. */
export function foregroundInputRefusal(programs: unknown[]): string | null {
  if (!programs.length)
    throw new Error(
      "agent_input_unavailable: The terminal could not be checked. Try again shortly. Nothing was sent.",
    );
  for (const value of programs) {
    const process = row(value);
    if (!process || typeof process.name !== "string" || !process.name)
      throw new Error(
        "agent_input_unavailable: The terminal could not be checked. Try again shortly. Nothing was sent.",
      );
    const words =
      Array.isArray(process.argv) &&
      process.argv.every((word) => typeof word === "string")
        ? (process.argv as string[])
        : [];
    const names = [base(process.name), ...(words[0] ? [base(words[0])] : [])];
    for (const name of names) {
      let kind = blocked.get(name);
      if (shells.has(name)) {
        // A script/-c launcher waits for its children; it does not read terminal
        // commands. Check those foreground children too (MCP launchers included).
        const args = words.slice(1);
        const scriptAt = args.findIndex(
          (word) => !word.startsWith("-") && !word.startsWith("+"),
        );
        const options = scriptAt < 0 ? args : args.slice(0, scriptAt);
        const interactive = options.some(
          (word) => word === "--interactive" || /^-[^-]*[is]/.test(word),
        );
        const script = args.some(
          (word) => !word.startsWith("-") && !word.startsWith("+"),
        );
        if (!interactive && script) continue;
        kind = "a shell";
      }
      if (
        /^(?:python(?:\d+(?:\.\d+)*)?|node(?:js)?|bun|deno|ruby|irb|pry|ipython\d*|julia|R|ghci|iex|erl|lua\d*(?:\.\d+)?)$/i.test(
          name,
        )
      ) {
        const args = words.slice(1);
        let interactive = false;
        // Script/module/eval invocations are allowed, including arbitrary npm
        // entrypoints. Bare interpreters and explicit interactive mode are REPLs.
        const valueOptions = new Set([
          "--title",
          "--require",
          "--import",
          "--loader",
          "--experimental-loader",
          "--input-type",
          "-r",
          "-W",
          "-X",
          "--project",
          "--sysimage",
        ]);
        let script = false;
        for (let at = 0; at < args.length; at++) {
          const word = args[at]!;
          if (valueOptions.has(word)) {
            at++;
            continue;
          }
          if (
            /^(?:--interactive|--inspect-repl|repl)$/.test(word) ||
            /^-[^-]*i/.test(word)
          )
            interactive = true;
          if (/^(?:-[ecmp]|--eval|--print)$/.test(word)) {
            script = Boolean(args[++at]);
            continue;
          }
          if (/^(?:--(?:eval|print)=|-[ecmp].+)/.test(word)) {
            script = true;
            continue;
          }
          if (word === "--") {
            script = Boolean(args[at + 1] && args[at + 1] !== "-");
            break;
          }
          if (!word.startsWith("-") && word !== "-") {
            script = true;
            break;
          }
        }
        if (
          interactive ||
          !script ||
          /^(irb|pry|ipython\d*|ghci|iex|erl)$/i.test(name)
        )
          kind = "a REPL";
      }
      if (kind)
        return `The agent isn't running in that terminal any more; it's ${kind} now. Nothing was sent.`;
    }
  }
  return null;
}

export function agentInputFailure(
  error: unknown,
): { reason: "changed" | "unavailable"; message: string } | null {
  if (!(error instanceof Error)) return null;
  const match = /^(agent_not_ready|agent_input_unavailable):\s*(.*)$/s.exec(
    error.message,
  );
  return match
    ? {
        reason: match[1] === "agent_not_ready" ? "changed" : "unavailable",
        message: `Not sent. ${match[2]}`,
      }
    : null;
}

export async function checkTuiForeground(
  call: TuiControlClient["call"],
  paneId: string,
): Promise<void> {
  const reply = row(await call("pane.process_info", { pane_id: paneId }));
  const process = row(reply?.process_info);
  if (
    !process ||
    !Number.isSafeInteger(process.foreground_process_group_id) ||
    Number(process.foreground_process_group_id) <= 0 ||
    (process.pane_id !== undefined && process.pane_id !== paneId) ||
    !Array.isArray(process.foreground_processes)
  )
    throw new Error("Foreground information could not be read");
  const reason = foregroundInputRefusal(process.foreground_processes);
  if (reason) throw new Error(`agent_not_ready: ${reason}`);
}

/** Resolve names to an exact pane, then read its foreground immediately before input. */
export async function guardAgentInput(
  client: TuiControlClient,
  params: Row,
  paneInput: boolean,
): Promise<string> {
  try {
    const target = paneInput ? params.pane_id : params.target;
    if (typeof target !== "string" || !target)
      throw new Error("Missing terminal target");
    let paneId = target;
    if (!paneInput) {
      const reply = row(await client.call("agent.get", { target }));
      const agent = row(reply?.agent);
      if (!agent || typeof agent.pane_id !== "string")
        throw new Error("Agent information could not be read");
      paneId = agent.pane_id;
    }
    await checkTuiForeground(client.call.bind(client), paneId);
    return paneId;
  } catch (error) {
    if (
      error instanceof Error &&
      /^(agent_not_ready|agent_input_unavailable):/.test(error.message)
    )
      throw error;
    throw new Error(
      "agent_input_unavailable: The terminal could not be checked. Try again shortly. Nothing was sent.",
      { cause: error },
    );
  }
}
