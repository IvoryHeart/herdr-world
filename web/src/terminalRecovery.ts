/** Exhausted local attach recovery keeps the app and last frame available. */
export const TERMINAL_NO_FRAME_MESSAGE = "Terminal is not receiving output";

/** Three acknowledged attaches without output exhaust one local recovery budget. */
export class TerminalRecoveryBudget {
  private failures = 0;

  fail(): "retry" | "unavailable" {
    return ++this.failures < 3 ? "retry" : "unavailable";
  }

  reset(): void {
    this.failures = 0;
  }
}
