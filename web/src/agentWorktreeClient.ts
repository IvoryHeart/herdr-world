import type { ConnectionClient } from "./api";
import type { AgentWorktreeTarget } from "../../shared/agentWorktree";

export function agentWorktreeClient(
  base: ConnectionClient,
  target: AgentWorktreeTarget | null,
  onBindingChanged?: () => void,
  isBindingCurrent: () => boolean = () => true,
): ConnectionClient {
  const isResourceCurrent = () => base.isCurrent() && isBindingCurrent();
  const changed = () =>
    new Error("Worktree selection changed; refresh before reading.");
  return {
    get connectionId() {
      return base.connectionId;
    },
    get generation() {
      return base.generation;
    },
    get serverRuntimeGeneration() {
      return base.serverRuntimeGeneration;
    },
    agentWorktree: target,
    isCurrent: () => base.isCurrent(),
    acceptsServerGeneration: (value) => base.acceptsServerGeneration(value),
    call(method, params, timeout) {
      if (!method.startsWith("file.") && !method.startsWith("git."))
        return base.call(method, params, timeout);
      if (!base.isCurrent())
        return Promise.reject(
          new Error(
            "Host is unavailable; refresh its worktree before reading.",
          ),
        );
      if (!isBindingCurrent()) return Promise.reject(changed());
      if (!target)
        return Promise.reject(
          new Error(
            "Choose a current agent worktree before reading Files or Changes.",
          ),
        );
      return base
        .call(method, { ...params, agent_worktree: target }, timeout)
        .then((value) => {
          if (!isResourceCurrent()) throw changed();
          return value;
        })
        .catch((error: unknown) => {
          if (
            isResourceCurrent() &&
            error instanceof Error &&
            /^(?:Worktree (?:selection|binding|branch)|Selected worktree|The agent (?:session )?changed)/u.test(
              error.message,
            )
          )
            onBindingChanged?.();
          throw error;
        });
    },
  };
}

export function agentWorktreeHttpEndpoint(
  client: Pick<ConnectionClient, "agentWorktree">,
  endpoint: string,
) {
  if (client.agentWorktree === undefined) return endpoint;
  if (!client.agentWorktree)
    throw new Error(
      "Choose a current agent worktree before opening its files.",
    );
  const url = new URL(endpoint, "https://world.example.invalid");
  url.searchParams.set("agent_worktree", JSON.stringify(client.agentWorktree));
  return `${url.pathname}${url.search}`;
}
