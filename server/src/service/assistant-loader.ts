import type { createAssistantService } from "../assistant/service";

type AssistantOptions = Parameters<typeof createAssistantService>[0];
type AssistantService = Awaited<ReturnType<typeof createAssistantService>>;

/**
 * Ranger, imported and started on first use. A failed start is retried on the
 * next use; stopping keeps a new one from starting.
 */
export function createAssistantLoader(
  options: Pick<
    AssistantOptions,
    "context" | "directory" | "publish" | "notify"
  > & {
    stopping(): boolean;
    warn(message: string): void;
  },
) {
  const { stopping, warn, ...assistant } = options;
  let task: Promise<AssistantService> | null = null;
  return {
    get() {
      // Ranger started now would outlive stop and its data folder.
      if (stopping()) return Promise.reject(new Error("World is stopping"));
      task ??= import("../assistant/service")
        .then(({ createAssistantService }) => createAssistantService(assistant))
        .catch((error) => {
          task = null;
          throw error;
        });
      return task;
    },
    resumeIfLoaded() {
      if (stopping()) return;
      void task
        ?.then((service) => service.resume())
        .catch(() => {
          warn("Ranger recovery could not be started");
        });
    },
    /** Dispose Ranger if it was started. */
    async dispose() {
      const started = task;
      task = null;
      await started?.then((service) => service.dispose()).catch(() => {});
    },
  };
}
