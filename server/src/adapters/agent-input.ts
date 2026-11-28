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
  ["a terminal multiplexer", "tmux screen zellij"],
  ["a shell launcher", "docker"],
  ["ssh", "ssh mosh"],
  ["sudo or su", "sudo su doas"],
  [
    "a database client",
    "psql mysql mariadb sqlite3 redis-cli mongosh mongo sqlplus sqlcmd cqlsh",
  ],
] as const)
  for (const name of names.split(" ")) blocked.set(name, kind);

/** Both runtimes pass only the runtime-reported foreground group leader. */
export function foregroundInputRefusal(leader: unknown): string | null {
  const process = row(leader);
  // Missing runtime information preserves the existing input behavior.
  if (typeof process?.name !== "string" || !process.name) return null;
  const name = base(process.name);
  const kind = shells.has(name)
    ? "a shell"
    : (blocked.get(name) ??
      (/^(?:python(?:\d+(?:\.\d+)*)?|node(?:js)?|bun|deno|ruby|irb|pry|ipython\d*|julia|r|ghci|iex|erl|lua\d*(?:\.\d+)?)$/.test(
        name,
      )
        ? "a REPL"
        : null));
  return kind
    ? `The agent isn't running in that terminal any more; it's ${kind} now. Nothing was sent.`
    : null;
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
  let reply: Row | null;
  try {
    reply = row(await call("pane.process_info", { pane_id: paneId }));
  } catch {
    // Older TUI runtimes may not provide process information.
    return;
  }
  const process = row(reply?.process_info);
  if (
    !process ||
    !Number.isSafeInteger(process.foreground_process_group_id) ||
    Number(process.foreground_process_group_id) <= 0 ||
    (process.pane_id !== undefined && process.pane_id !== paneId) ||
    !Array.isArray(process.foreground_processes)
  )
    return;
  const leader = process.foreground_processes.find(
    (value) => row(value)?.pid === process.foreground_process_group_id,
  );
  const reason = foregroundInputRefusal(leader);
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
