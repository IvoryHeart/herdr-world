import { createAssistantContext } from "../../server/src/assistant/context";
import {
  prepareAssistantAction,
  type PreparedAssistantAction,
} from "../../server/src/assistant/actions";
import type { LegacyConnectionRuntime } from "../../server/src/connections/runtime";
import { observe } from "./observations";
import type { TraceState } from "./replay";
export type AuthorityState = {
  phase: string;
  permission: boolean;
  taskActive: boolean;
  serviceActive: boolean;
  runtimeCurrent: boolean;
  workspaceCurrent: boolean;
  writes: number;
  result: string;
};
export async function replayRangerAuthority(
  states: TraceState[],
  prepare = prepareAssistantAction,
) {
  let current = true;
  let workspaceCurrent = true;
  let permission = true;
  let taskActive = true;
  let serviceActive = true;
  let executing = false;
  let writes = 0;
  let writeParams: Record<string, unknown> | undefined;
  const checking = Promise.withResolvers<void>();
  const checked = Promise.withResolvers<void>();
  const dispatching = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const workspaces = [
    {
      workspace_id: "synthetic-workspace",
      label: "Synthetic source",
      cwd: "/synthetic/source",
    },
  ];
  const runtime = {
    identity: {
      id: "synthetic-host",
      label: "Synthetic host",
      source: "synthetic",
    },
    recoveryIdentity: async () => "synthetic-boot",
    herdr: {
      call: async (
        method: string,
        params: Record<string, unknown> = {},
        _timeout?: number,
        beforeSend?: () => void,
      ) => {
        if (method === "workspace.get") {
          const found = workspaces.find(
            (workspace) => workspace.workspace_id === params.workspace_id,
          );
          return {
            workspace: found && {
              ...found,
              cwd:
                found.workspace_id === "synthetic-workspace" &&
                !workspaceCurrent
                  ? "/synthetic/replaced"
                  : found.cwd,
            },
          };
        }
        if (method === "workspace.list") {
          if (executing && !writes) {
            checking.resolve();
            await checked.promise;
          }
          return { workspaces };
        }
        if (method === "workspace.create") {
          dispatching.resolve();
          await release.promise;
          beforeSend?.();
          writes++;
          writeParams = params;
          const created = {
            workspace_id: "synthetic-created",
            label: String(params.label),
            cwd: String(params.cwd),
          };
          workspaces.push(created);
          return { workspace: created };
        }
        if (method === "pane.list")
          return {
            panes: [
              {
                workspace_id: "synthetic-created",
                pane_id: "synthetic-pane",
                cwd: "/synthetic/created",
              },
            ],
          };
        throw new Error(`Unexpected Ranger fixture method ${method}`);
      },
    },
  } as unknown as LegacyConnectionRuntime;
  const lease = { runtime, generation: 1, isCurrent: () => current };
  const context = createAssistantContext({
    catalog: () => [{ id: "synthetic-host", label: "Synthetic host" }],
    lease: () => lease,
    recoveryFingerprint: () => "a".repeat(64),
  });
  let prepared: PreparedAssistantAction | undefined;
  let task:
    | Promise<Awaited<ReturnType<PreparedAssistantAction["execute"]>>>
    | undefined;
  let result:
    | Awaited<ReturnType<PreparedAssistantAction["execute"]>>
    | undefined;
  let captured: Awaited<ReturnType<typeof context.captureScope>> | undefined;
  const params = {
    connection_id: "synthetic-host",
    workspace_id: "synthetic-workspace",
    label: "Synthetic created",
    cwd: "/synthetic/created",
  };
  const witnesses = new Set<string>();
  try {
    for (const state of states) {
      const expected = state.authority;
      switch (state.op) {
        case "init":
          break;
        case "prepare":
          // All previews start from admitted scope; controls apply after capture.
          captured = await context.captureScope([
            {
              connection_id: "synthetic-host",
              workspace_id: "synthetic-workspace",
              runtime_generation: 1,
            },
          ]);
          prepared = await prepare({
            kind: "create_workspace",
            target: captured[0]!,
            lease,
            params,
          });
          break;
        case "execute":
          executing = true;
          task = prepared!.execute(
            () => permission && taskActive && serviceActive,
          );
          {
            const reached = await Promise.race([
              checking.promise.then(() => true),
              task.then(() => false),
            ]);
            observe(
              "ranger.checking.expected",
              reached,
              expected.phase !== "done",
            );
            if (!reached) result = await task;
          }
          break;
        case "checked": {
          checked.resolve();
          const reached = await Promise.race([
            dispatching.promise.then(() => true),
            task!.then(() => false),
          ]);
          observe(
            "ranger.dispatch.allowed",
            reached,
            expected.phase !== "done",
          );
          if (!reached) result = await task;
          break;
        }
        case "release":
          release.resolve();
          result = await task;
          break;
        case "duplicate":
          observe(
            "ranger.execution.identity",
            prepared!.execute(() => permission && taskActive && serviceActive),
            task,
          );
          witnesses.add("duplicateExecution");
          break;
        case "revoke":
          permission = false;
          break;
        case "stopTask":
          taskActive = false;
          break;
        case "dispose":
          serviceActive = false;
          break;
        case "retire":
          current = false;
          break;
        case "replaceWorkspace":
          workspaceCurrent = false;
          break;
        case "mutateInput":
          params.label = "Synthetic changed input";
          params.cwd = "/synthetic/changed";
          break;
        default:
          throw new Error("Unknown Ranger authority action");
      }
      observe("ranger.writes", writes, expected.writes);
      observe("ranger.result", result?.status ?? "none", expected.result);
      if (writeParams) {
        observe("ranger.write.label", writeParams.label, "Synthetic created");
        observe("ranger.write.cwd", writeParams.cwd, "/synthetic/created");
        observe("ranger.write.focus", writeParams.focus, false);
      }
      if (expected.phase === "done") {
        if (!permission) witnesses.add("permissionBlocked");
        if (!taskActive) witnesses.add("taskBlocked");
        if (!serviceActive) witnesses.add("serviceBlocked");
        if (!current) witnesses.add("runtimeBlocked");
        if (!workspaceCurrent) witnesses.add("workspaceBlocked");
        if (writes) witnesses.add("authorizedWrite");
      }
    }
  } finally {
    checked.resolve();
    release.resolve();
    await task;
  }
  return witnesses;
}
