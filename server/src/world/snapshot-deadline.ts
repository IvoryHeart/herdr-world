import type { Scheduler } from "../service/clock";

/** Close admission before releasing the deadline, including a rejected observation. */
export async function settleSnapshotObservations(
  observations: Promise<unknown>[],
  scheduler: Scheduler,
  timeoutMs: number,
  closeAdmission: () => void,
) {
  let deadline: ReturnType<Scheduler["schedule"]> | undefined;
  try {
    await Promise.race([
      Promise.all(observations),
      new Promise<void>((resolve) => {
        deadline = scheduler.schedule(resolve, timeoutMs);
      }),
    ]);
  } finally {
    closeAdmission();
    deadline?.cancel();
  }
}
