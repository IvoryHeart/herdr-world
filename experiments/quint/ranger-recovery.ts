import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAssistantContext,
  type RecoveryTarget,
} from "../../server/src/assistant/context";
import {
  openTaskStorage,
  type TaskStorage,
} from "../../server/src/assistant/task-storage";
import {
  validateSavedTasks,
  type PreparedTask,
  type SavedTaskState,
} from "../../server/src/assistant/tasks";
import type { LegacyConnectionRuntime } from "../../server/src/connections/runtime";
import { observe } from "./observations";
import type { TraceState } from "./replay";
export type RecoveryState = {
  captured: boolean;
  saved: boolean;
  opened: boolean;
  loaded: boolean;
  endpoint: boolean;
  boot: boolean;
  workspace: boolean;
  generation: number;
  recovered: boolean;
  result: string;
};
export async function replayRangerRecovery(
  states: TraceState[],
  openStorage = openTaskStorage,
) {
  const directory = mkdtempSync(join(tmpdir(), "synthetic-quint-recovery-"));
  let generation = 1;
  let endpoint = true;
  let boot = true;
  let workspace = true;
  const runtime = {
    identity: {
      id: "synthetic-host",
      label: "Synthetic host",
      source: "synthetic",
    },
    recoveryIdentity: async () =>
      boot ? "synthetic-boot" : "synthetic-replaced-boot",
    herdr: {
      call: async (method: string) => {
        assert.equal(method, "workspace.get");
        return {
          workspace: {
            workspace_id: "synthetic-workspace",
            label: "Synthetic workspace",
            cwd: workspace ? "/synthetic/source" : "/synthetic/replaced",
          },
        };
      },
    },
  } as unknown as LegacyConnectionRuntime;
  const context = createAssistantContext({
    catalog: () => [{ id: "synthetic-host", label: "Synthetic host" }],
    recoveryFingerprint: () => (endpoint ? "a" : "b").repeat(64),
    lease: () => {
      const captured = generation;
      return {
        runtime,
        generation: captured,
        isCurrent: () => generation === captured,
      };
    },
  });
  let storage: TaskStorage | undefined;
  let prepared: PreparedTask | undefined;
  let saved: SavedTaskState | undefined;
  let targets: RecoveryTarget[] | undefined;
  let result = "none";
  const witnesses = new Set<string>();
  const ref = {
    connection_id: "synthetic-host",
    workspace_id: "synthetic-workspace",
  };
  const taskId = "00000000-0000-4000-8000-000000000001";
  const date = "2026-10-01T00:00:00Z";
  try {
    storage = openStorage(directory, validateSavedTasks);
    for (const state of states) {
      const expected = state.recovery;
      switch (state.op) {
        case "init":
          break;
        case "capture": {
          const captured = await context.captureScope([
            { ...ref, runtime_generation: 1 },
          ]);
          targets = await context.recoveryScope(captured);
          prepared = {
            input: {
              title: "Synthetic committed",
              prompt: "Inspect synthetic scope",
              scope: [ref],
              schedule: { type: "interval", minutes: 60 },
            },
            config: {
              provider: "synthetic",
              model: "synthetic",
              credential_source: "assistant",
              allowed_workspaces: [ref],
            },
            targets,
            workspaces: captured,
          };
          break;
        }
        case "save": {
          saved = {
            tasks: [
              {
                ...prepared!,
                task: {
                  id: taskId,
                  status: "paused",
                  created_at: date,
                  updated_at: date,
                  next_run_at: null,
                },
                runs: [
                  {
                    ...prepared!,
                    id: "00000000-0000-4000-8000-000000000002",
                    task_id: taskId,
                    status: "running",
                    scheduled_at: date,
                    started_at: date,
                    error: null,
                    manual: true,
                  },
                ],
              },
            ],
            proposals: [],
            requests: [],
          };
          storage!.save(saved);
          break;
        }
        case "failedSave": {
          const database = new Database(join(directory, "tasks.sqlite"));
          try {
            database.exec(
              "CREATE TRIGGER IF NOT EXISTS synthetic_rejected_write BEFORE INSERT ON tasks WHEN NEW.title = 'Synthetic rejected' BEGIN SELECT RAISE(ABORT, 'synthetic rejected transaction'); END;",
            );
          } finally {
            database.close();
          }
          const replacement = structuredClone(saved!);
          replacement.tasks[0]!.input.title = "Synthetic rejected";
          let rejected = false;
          try {
            storage!.save(replacement);
          } catch (error) {
            assert(error instanceof Error);
            assert.match(error.message, /synthetic rejected transaction/);
            rejected = true;
          }
          observe("recovery.transaction.rejected", rejected, true);
          witnesses.add("transactionFailure");
          break;
        }
        case "close":
          storage!.close();
          storage = undefined;
          break;
        case "reopen":
          storage = openStorage(directory, validateSavedTasks);
          saved = storage.load();
          targets = saved.tasks[0]!.targets;
          break;
        case "runtimeReplacement":
          generation = 3;
          break;
        case "endpointReplacement":
          endpoint = false;
          break;
        case "bootReplacement":
          boot = false;
          break;
        case "workspaceReplacement":
          workspace = false;
          break;
        case "recover": {
          let restored:
            | Awaited<ReturnType<typeof context.restoreScope>>
            | undefined;
          try {
            restored = await context.restoreScope(targets!);
            result = "accepted";
          } catch (error) {
            assert(error instanceof Error);
            assert.match(
              error.message,
              /recovery (endpoint|server identity|workspace) changed/,
            );
            result = "rejected";
          }
          if (restored) {
            observe(
              "recovery.fresh.generation",
              restored[0]!.runtime_generation,
              generation,
            );
            witnesses.add("stableRecovery");
            if (generation === 3) witnesses.add("freshGeneration");
          }
          if (!endpoint) witnesses.add("endpointRejected");
          if (!boot) witnesses.add("bootRejected");
          if (!workspace) witnesses.add("workspaceRejected");
          break;
        }
        default:
          throw new Error("Unknown Ranger recovery action");
      }
      observe("recovery.result", result, expected.result);
      if (storage) {
        const durable = storage.load();
        observe(
          "recovery.persisted.task",
          durable.tasks.length,
          expected.saved ? 1 : 0,
        );
        if (expected.saved) {
          observe(
            "recovery.persisted.title",
            durable.tasks[0]!.input.title,
            "Synthetic committed",
          );
          observe(
            "recovery.persisted.run",
            durable.tasks[0]!.runs[0]!.status,
            "running",
          );
          observe(
            "recovery.persisted.targets",
            durable.tasks[0]!.targets,
            prepared!.targets,
          );
        }
      }
    }
  } finally {
    storage?.close();
    rmSync(directory, { recursive: true, force: true });
  }
  return witnesses;
}
