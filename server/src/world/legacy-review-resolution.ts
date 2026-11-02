import type { MarkBody, TerminalMarksPort } from "../storage/terminal-marks";
import type { LegacyReviewProof } from "../storage/legacy-review-archive";
import type { admittedAgentPanes } from "./desk-observation";

export async function legacyReviewCandidates(
  storage: TerminalMarksPort,
  connectionId: string,
  panes: readonly Record<string, unknown>[],
  admitted: ReturnType<typeof admittedAgentPanes>,
  isCurrent: () => boolean,
) {
  const byTerminal = new Map(
    admitted.map((agent) => [agent.terminalId, agent]),
  );
  const proofs = new Map<string, LegacyReviewProof>(
    panes.map((pane) => {
      const terminal = String(pane.terminal_id),
        agent = byTerminal.get(terminal);
      return [
        terminal,
        {
          terminal_id: terminal,
          session: agent?.session ?? null,
          sequence:
            Number.isSafeInteger(agent?.sequence) &&
            Number(agent?.sequence) >= 0
              ? Number(agent?.sequence)
              : null,
          status: agent?.status ?? "unknown",
          last_activity_at: agent?.lastActivityAt ?? null,
          activity_matches: agent?.activityMatchesWorld ?? false,
        },
      ];
    }),
  );
  const resolvable = storage.archiveStatus().count
    ? await storage.observeLegacy(
        connectionId,
        [...proofs.keys()],
        [...proofs.values()],
        isCurrent,
      )
    : new Set<string>();
  return { proofs, resolvable };
}

/** Include any possible migrated mark in the whole-plan capacity upper bound. */
export function legacyReviewBudgetBody(
  body: MarkBody,
  proof: LegacyReviewProof | undefined,
  resolvable: boolean,
): MarkBody {
  return resolvable &&
    proof &&
    proof.sequence === body.stateChangeSeq &&
    body.reviewed_stop === null &&
    typeof body.observed_stop_id === "string"
    ? {
        ...body,
        reviewed_stop: `stop:${JSON.stringify([body.observed_stop_id, proof.last_activity_at])}`,
      }
    : body;
}
