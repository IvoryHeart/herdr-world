import { readReadiness } from "../harness-readiness";
import { basename } from "node:path";
import type { AgentAddress } from "../../../../shared/agentMove";
import type { MoveRuntime } from "./runtime";
import { shQuote as q } from "../../utils/process-utils";

export type MoveSession = {
  kind: "claude" | "codex";
  id: string;
  path: string;
  cwd: string;
  group: number;
};
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export async function readMoveSession(
  runtime: MoveRuntime,
  a: AgentAddress,
): Promise<MoveSession> {
  const actual = await runtime.address(a.pane_id);
  if (
    actual.terminal_id !== a.terminal_id ||
    actual.tab_id !== a.tab_id ||
    actual.workspace_id !== a.workspace_id ||
    actual.color_key !== a.color_key
  )
    throw new Error("The agent moved or was replaced. Refresh before moving.");
  const conversation = await runtime.latest(a);
  if (!["claude", "codex"].includes(conversation.agent ?? ""))
    throw new Error("Move supports Claude and Codex agents.");
  if (!["idle", "done"].includes(conversation.agent_status ?? ""))
    throw new Error(
      "This agent is busy or waiting at a dialog. Wait until it is idle before moving.",
    );
  if (conversation.pending_prompt)
    throw new Error("Close the agent's dialog before moving.");
  if (
    conversation.status !== "ok" ||
    !conversation.session_fingerprint ||
    conversation.session_binding === "guessed"
  )
    throw new Error(
      "World needs a harness-reported conversation or a launch command with its exact resume ID.",
    );
  if (
    conversation.running_tool ||
    conversation.deliveries.some((d) => d.state === "pending")
  )
    throw new Error(
      "This agent has background work or a message pending. Let it finish before moving.",
    );
  const resolved = await runtime.summary(a);
  const id =
    resolved.file?.sessionId ??
    (resolved.session?.kind === "id"
      ? resolved.session.value
      : /[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i.exec(
          basename(resolved.path),
        )?.[0]);
  if (resolved.status !== "ok" || !id || !UUID.test(id))
    throw new Error("World cannot read a complete conversation resume ID.");
  if (resolved.session?.source === "world-link") {
    const native = await runtime.resumeIdentity(a, resolved.agent);
    const nativeId =
      native?.kind === "id"
        ? native.value
        : native
          ? /[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i.exec(
              basename(native.value),
            )?.[0]
          : undefined;
    if (nativeId?.toLowerCase() !== id.toLowerCase())
      throw new Error(
        "This conversation is linked for reading only. Move needs a matching native resume ID.",
      );
  }
  const confirmed = await runtime.latest(a);
  if (
    resolved.agent !== conversation.agent ||
    confirmed.session_fingerprint !== conversation.session_fingerprint ||
    confirmed.agent !== conversation.agent ||
    !["idle", "done"].includes(confirmed.agent_status ?? "") ||
    confirmed.pending_prompt ||
    confirmed.running_tool ||
    confirmed.deliveries.some((delivery) => delivery.state === "pending")
  )
    throw new Error(
      "The source conversation or readiness changed during the check. Wait until it is idle and try again.",
    );
  const fg = await runtime.foreground(a);
  if (!fg.cwd.startsWith("/") || /[\r\n\0]/.test(fg.cwd))
    throw new Error("The agent's folder cannot be used for a move.");
  return {
    kind: conversation.agent as MoveSession["kind"],
    id: id.toLowerCase(),
    path: resolved.path,
    cwd: fg.cwd,
    group: fg.group,
  };
}

export type PreparedShell = {
  address: AgentAddress;
  runtime: MoveRuntime;
  directory: string;
  executable: string;
  config: string;
  cwd: string;
  transcriptTarget?: string;
  sharedTranscript?: boolean;
  baseline?: boolean;
};
export async function prepareShell(
  runtime: MoveRuntime,
  address: AgentAddress,
  session: MoveSession,
  cwd: string,
): Promise<PreparedShell> {
  const directory = (await runtime.run("umask 077; mktemp -d")).trim();
  if (!directory.startsWith("/") || /[\r\n\0]/.test(directory))
    throw new Error("The host could not prepare a private move directory.");
  const config =
    session.kind === "codex"
      ? "${CODEX_HOME:-$HOME/.codex}"
      : "${CLAUDE_CONFIG_DIR:-$HOME/.claude}";
  await runtime.shellCommand(
    address,
    `umask 077; cd ${q(cwd)} && command -v ${session.kind} > ${q(directory + "/executable")} && printf '%s' "${config}" > ${q(directory + "/config")} && touch ${q(directory + "/ready")}`,
  );
  await runtime.run(`test -f ${q(directory + "/ready")}`);
  const authArgs = session.kind === "codex" ? "login status" : "auth status";
  await runtime.shellCommand(
    address,
    `b=$(cat ${q(directory + "/executable")}); "$b" ${authArgs} > ${q(directory + "/auth")} 2>&1; printf '%s' "$?" > ${q(directory + "/auth-code")}`,
  );
  const auth = await runtime.run(
    `test "$(wc -c < ${q(directory + "/auth")})" -le 4000 && cat ${q(directory + "/auth")}`,
  );
  const code = (await runtime.run(`cat ${q(directory + "/auth-code")}`)).trim();
  const readiness = readReadiness(
    [session.kind],
    `@@kind ${session.kind}\n@@found\n${auth}\n@@exit ${code}\n@@end`,
  )[0];
  if (readiness?.logged_in !== true)
    throw new Error(
      "Sign in to the harness in that host's shell before moving.",
    );
  const executable = (
    await runtime.run(`cat ${q(directory + "/executable")}`)
  ).trim();
  const configPath = (
    await runtime.run(`cat ${q(directory + "/config")}`)
  ).trim();
  if (
    !executable.startsWith("/") ||
    !configPath.startsWith("/") ||
    /[\r\n\0]/.test(executable + configPath)
  )
    throw new Error(
      "The harness executable or session directory was not found in that shell.",
    );
  return { address, runtime, directory, executable, config: configPath, cwd };
}

export { copyMoveSession } from "./transcript";

export async function resumeInShell(
  shell: PreparedShell,
  session: MoveSession,
): Promise<void> {
  const args =
    session.kind === "codex"
      ? ["resume", session.id, "--cd", shell.cwd]
      : ["--resume", session.id];
  await shell.runtime.input(
    shell.address,
    `cd ${q(shell.cwd)} && ${[shell.executable, ...args].map(q).join(" ")}`,
  );
  // Native status/session observation, not terminal output resembling a prompt.
  const { observeUntil } = await import("./wait");
  await observeUntil(
    shell.runtime.subscribe,
    async () => {
      const actual = await shell.runtime.address(shell.address.pane_id);
      if (actual.terminal_id !== shell.address.terminal_id)
        throw new Error("The prepared terminal was replaced.");
      const latest = await shell.runtime.latest(actual);
      if (latest.agent_status === "blocked")
        throw new Error("The resumed agent stopped at a dialog.");
      if (!["idle", "done"].includes(latest.agent_status ?? "")) return null;
      const resolved = await shell.runtime.summary(actual);
      const id =
        resolved.file?.sessionId ??
        (resolved.session?.kind === "id"
          ? resolved.session.value
          : /[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i.exec(
              basename(resolved.path),
            )?.[0]);
      if (
        resolved.agent === session.kind &&
        id?.toLowerCase() === session.id.toLowerCase() &&
        latest.session_fingerprint
      )
        return true;
      return null;
    },
    60_000,
  );
}
