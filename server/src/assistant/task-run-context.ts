import type { AssistantWorkspaceRef } from "../../../shared/assistant";
import type { AssistantContext } from "./context";
import type { createAssistantService } from "./service";
import { refKey } from "./assistant-state";
export function createTaskRunContext(
  options: Parameters<typeof createAssistantService>[0],
  baseContext: AssistantContext,
  lifetime: () => {
    disposed: boolean;
    stopRevision: number;
    signal?: AbortSignal;
  },
) {
  function globallyAllowed(ref: AssistantWorkspaceRef) {
    return (
      options.globalWorkspaceAllowed?.(ref) ??
      options
        .globalAllowed?.()
        .some((allowed) => refKey(allowed) === refKey(ref)) ??
      false
    );
  }
  function assertTaskAllowed() {
    if (
      options.taskRun &&
      options.taskRun.targets.some((target) => !globallyAllowed(target))
    )
      throw new Error("The task workspace permission was removed.");
  }
  const checkTaskScope = async (signal?: AbortSignal) => {
    if (!options.taskRun) return;
    await options.refreshGlobalScope?.();
    signal?.throwIfAborted();
    if (
      options.taskRun.targets.some((target) => !globallyAllowed(target)) ||
      !baseContext.restoreScope
    )
      throw new Error("The task workspace permission was removed.");
    await baseContext.restoreScope(options.taskRun.targets, signal);
    signal?.throwIfAborted();
    if (options.taskRun.targets.some((target) => !globallyAllowed(target)))
      throw new Error("The task workspace permission was removed.");
  };
  const context: AssistantContext = options.taskRun
    ? {
        ...baseContext,
        captureScope: async (refs, signal) => {
          if (
            JSON.stringify(refs.map(refKey).sort()) !==
            JSON.stringify(options.taskRun!.targets.map(refKey).sort())
          )
            throw new Error("Invalid scheduled task scope");
          await checkTaskScope(signal);
          return baseContext.restoreScope!(options.taskRun!.targets, signal);
        },
        restoreScope: async (targets, signal) => {
          if (
            JSON.stringify(targets) !== JSON.stringify(options.taskRun!.targets)
          )
            throw new Error("The scheduled task identity changed.");
          await checkTaskScope(signal);
          return baseContext.restoreScope!(options.taskRun!.targets, signal);
        },
        // Only a workspace this run created joins it (chatWorkspaceAllowed).
        extendScope: baseContext.extendScope
          ? async (captured, refs, signal) => {
              await checkTaskScope(signal);
              return baseContext.extendScope!(captured, refs, signal);
            }
          : undefined,
        read: async (kind, captured, params, signal) => {
          await checkTaskScope(signal);
          const result = await baseContext.read(kind, captured, params, signal);
          await checkTaskScope(signal);
          return result;
        },
        prepareAction: baseContext.prepareAction
          ? async (kind, captured, params, signal) => {
              await checkTaskScope(signal);
              const prepared = await baseContext.prepareAction!(
                kind,
                captured,
                params,
                signal,
              );
              await checkTaskScope(signal);
              return {
                preview: prepared.preview,
                execute: async (authorized?: () => boolean) => {
                  const admittedStopRevision = lifetime().stopRevision;
                  const signal = lifetime().signal;
                  await checkTaskScope();
                  const result = await prepared.execute(() => {
                    if (
                      lifetime().disposed ||
                      lifetime().stopRevision !== admittedStopRevision ||
                      signal?.aborted ||
                      authorized?.() === false
                    )
                      return false;
                    try {
                      assertTaskAllowed();
                      return true;
                    } catch {
                      return false;
                    }
                  });
                  await checkTaskScope();
                  return result;
                },
              };
            }
          : undefined,
      }
    : baseContext;

  return { globallyAllowed, assertTaskAllowed, checkTaskScope, context };
}
