import type { AgentWorktreeObservation } from "../../shared/agentWorktree";

/**
 * Testing only: `?worktreeChanged` makes the first agent window that reads
 * its worktree see that evidence as stale, as when the agent moved folder or
 * branch while it worked and the re-read came back stale (#837). The
 * parameter is removed at once; opening Files reads the worktree again. It
 * is not a user-facing control.
 */
const PARAM = "worktreeChanged";
let armed: boolean | undefined;

function take(search: string) {
  if (armed !== undefined) return;
  armed = new URLSearchParams(search).has(PARAM);
  if (!armed || typeof history === "undefined") return;
  const url = new URL(location.href);
  url.searchParams.delete(PARAM);
  history.replaceState(history.state, "", url);
}

if (typeof location !== "undefined") take(location.search);

/** The observation as loaded, or once per page with the switch, stale. */
export function worktreeChangeTrial(
  observation: AgentWorktreeObservation,
): AgentWorktreeObservation {
  if (!armed || observation.state === "stale" || !observation.candidates.length)
    return observation;
  armed = false;
  return {
    ...observation,
    state: "stale",
    reason: "Testing: the worktree changed while the agent worked.",
  };
}

/** Test hook: arm or disarm the switch as a page load with `search` would. */
export function __setWorktreeChangeTrialForTests(search: string) {
  armed = undefined;
  take(search);
}
