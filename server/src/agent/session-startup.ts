/** Human guidance only: this evidence never grants conversation/send authority. */
export function createSessionStartupTracker(
  now: () => number = () => performance.now(),
  limit = 256,
) {
  const running = new Map<string, { witness: string; since: number }>();
  return {
    clear(paneId: string) {
      running.delete(paneId);
    },
    clearAll() {
      running.clear();
    },
    message(
      paneId: string,
      agent: string,
      info: Record<string, unknown> | null,
    ): string | null {
      const label = agent
        ? agent[0].toUpperCase() + agent.slice(1)
        : "The agent";
      const status = info?.agent_status;
      const terminal =
        typeof info?.terminal_id === "string" ? info.terminal_id : "";
      const eligible =
        terminal &&
        info?.launch_pending !== true &&
        (status === "working" ||
          (["idle", "done"].includes(String(status)) &&
            info?.interactive_ready === true));
      if (!eligible) {
        running.delete(paneId);
        return status === "blocked"
          ? `${label} is waiting for you in Terminal and has not reported a conversation yet.`
          : `${label} has not reported a conversation yet. Open Terminal to finish startup or check for a question.`;
      }
      const witness = JSON.stringify([terminal, agent]);
      const previous = running.get(paneId);
      const record =
        previous?.witness === witness ? previous : { witness, since: now() };
      running.delete(paneId);
      running.set(paneId, record);
      while (running.size > limit) running.delete(running.keys().next().value!);
      return now() - record.since < 30_000
        ? `${label} is starting and has not reported a conversation yet. Check Terminal while it finishes.`
        : null;
    },
  };
}
