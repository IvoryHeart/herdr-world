import type { AssistantWorkspace } from "../../../shared/assistant";
import { CoreRpcError } from "../herdr-core/client";
import { CoreFenceError, CoreOperationFence } from "../herdr-core/fence";
import type { CoreHostRuntime } from "../herdr-core/host-runtime";
import type { PreparedAssistantAction } from "./actions";
import { AssistantUserError } from "./errors";

/** Ranger uses exactly core's native send, under its captured preview. */
export async function prepareCoreSend(args: {
  target: AssistantWorkspace;
  lease: { runtime: CoreHostRuntime; generation: number; isCurrent(): boolean };
  params: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<PreparedAssistantAction> {
  const { target, lease, params, signal } = args;
  signal?.throwIfAborted();
  if (
    Object.keys(params).some(
      (k) =>
        !["connection_id", "workspace_id", "pane_id", "prompt"].includes(k),
    ) ||
    params.connection_id !== target.connection_id ||
    params.workspace_id !== target.workspace_id ||
    typeof params.pane_id !== "string" ||
    typeof params.prompt !== "string" ||
    !params.prompt.trim() ||
    params.prompt.length > 8000 ||
    /[\0\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(params.prompt)
  )
    throw new AssistantUserError(
      "Invalid prompt or target outside the approved scope",
    );
  const paneId = params.pane_id,
    prompt = params.prompt;
  const host = lease.runtime;
  if (!host.lease.runtime.offers("terminal.send"))
    throw new AssistantUserError(
      "This core does not offer native send; nothing was submitted.",
    );
  const pane = (await host.operations.getTerminal({ pane_id: paneId })).pane;
  if (
    !lease.isCurrent() ||
    pane?.workspace_id !== target.workspace_id ||
    !pane.agent
  )
    throw new AssistantUserError("The target agent changed");
  const fence = CoreOperationFence.admit(host.lease, paneId);
  if (!fence.occupant?.foreground)
    throw new AssistantUserError(
      "The agent's foreground cannot be checked yet",
    );
  signal?.throwIfAborted();
  let execution: ReturnType<PreparedAssistantAction["execute"]> | undefined;
  return {
    preview: {
      kind: "send_prompt",
      connection_id: target.connection_id,
      workspace_id: target.workspace_id,
      runtime_generation: lease.generation,
      connection_label: target.connection_label,
      workspace_label: target.label,
      params: { pane_id: paneId, prompt, runtime: "herdr-core" },
      summary:
        "Send this prompt through herdr-core after checking the original program and foreground. Core pastes and submits it; an uncertain send is never retried automatically.",
    },
    execute(authorized) {
      execution ??= (async () => {
        let dispatched = false;
        try {
          await host.lease.runtime.send(
            fence,
            prompt,
            async () => {
              if (!lease.isCurrent() || (authorized && !authorized()))
                return false;
              const current = (
                await host.operations.getTerminal({ pane_id: paneId })
              ).pane;
              return current?.workspace_id === target.workspace_id;
            },
            undefined,
            () => {
              if (!lease.isCurrent() || (authorized && !authorized()))
                return false;
              dispatched = true;
              return true;
            },
          );
          return {
            status: "succeeded" as const,
            detail: "herdr-core accepted the prompt for the original agent.",
          };
        } catch (error) {
          const refused =
            !dispatched ||
            error instanceof CoreRpcError ||
            (error instanceof CoreFenceError && error.stage !== "publication");
          return {
            status: refused ? ("failed" as const) : ("uncertain" as const),
            detail: refused
              ? "The original target or authorization changed, or core refused the prompt. Nothing was submitted."
              : "The core send outcome is uncertain. Inspect the agent before trying again; it will not be retried automatically.",
          };
        }
      })();
      return execution;
    },
  };
}
