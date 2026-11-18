/** Quit-before-resume handoff. Every launch has one owner, even after lost replies. */
export type HandoffPorts = {
  prepare(): Promise<void>;
  recheck(): Promise<void>;
  quit(): Promise<void>;
  sourceStopped(): Promise<boolean>;
  resume(): Promise<void>;
  stopDestination(): Promise<void>;
  rollback(): Promise<void>;
  transfer(): Promise<void>;
  closeSource(): Promise<void>;
  cleanup(): Promise<void>;
};
export type HandoffResult = {
  status: "moved" | "refused" | "rolled_back" | "uncertain";
  message: string;
};
const detail = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export async function handoff(p: HandoffPorts): Promise<HandoffResult> {
  let quitAttempted = false;
  let resumed = false;
  let sourceRetained = false;
  try {
    await p.prepare();
    await p.recheck();
    quitAttempted = true;
    try {
      await p.quit();
    } catch {
      /* A lost reply is not evidence of life or death. */
    }
    if (!(await p.sourceStopped())) {
      sourceRetained = true;
      return {
        status: "refused",
        message:
          "The original agent has not exited. Nothing was resumed elsewhere.",
      };
    }
    await p.resume();
    await p.transfer();
    resumed = true;
    try {
      await p.closeSource();
      return {
        status: "moved",
        message: "Moved the same conversation and its World details.",
      };
    } catch {
      return {
        status: "moved",
        message:
          "Moved the conversation and its World details. The old terminal could not be closed.",
      };
    }
  } catch (error) {
    if (!quitAttempted) return { status: "refused", message: detail(error) };
    try {
      if (!(await p.sourceStopped()))
        return {
          status: "uncertain",
          message:
            "World could not confirm that the original agent exited. Nothing else was resumed; inspect its terminal.",
        };
      // Native terminal closure must be confirmed before any rollback launch.
      await p.stopDestination();
      await p.rollback();
      return {
        status: "rolled_back",
        message: `Move failed; the conversation is running again in its original tab. ${detail(error)}`,
      };
    } catch {
      return {
        status: "uncertain",
        message:
          "Move was interrupted and recovery could not be confirmed. World has not started another copy. Inspect the source and destination terminals before resuming manually.",
      };
    }
  } finally {
    // Cleanup is limited to known unused shells; never ends the chosen agent.
    if (resumed || !quitAttempted || sourceRetained)
      await p.cleanup().catch(() => {});
  }
}
