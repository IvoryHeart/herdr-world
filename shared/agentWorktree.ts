/** Worktree observations describe evidence; viewer selection grants no ownership. */
export type AgentWorktreeSource =
  | "foreground_cwd"
  | "session_cwd"
  | "agent_report"
  | "branch_match"
  | "worktree_list";
export type AgentWorktreeSubject = {
  connectionId: string;
  generation: number;
  paneId: string;
  terminalId?: string;
  sessionFingerprint: string | null;
};
export type AgentWorktreeCandidate = {
  candidateId: string;
  canonicalRoot: string;
  gitCommonDir: string;
  gitIdentity?: string;
  branch: string | null;
  head?: string;
  source: AgentWorktreeSource;
  evidence: {
    sourceRef: string;
    observedAt: string;
    basis: "reported" | "inferred";
  };
};
export type AgentWorktreeObservation = {
  subject: AgentWorktreeSubject;
  revision: string;
  observedAt: string;
  state: "resolved" | "ambiguous" | "unavailable" | "stale";
  candidates: AgentWorktreeCandidate[];
  selectedCandidateId: string | null;
  reason?: string;
  reportedPr?: string;
  truncated?: boolean;
  unavailableEvidence?: {
    path: string;
    source: AgentWorktreeSource;
    reason: string;
  }[];
};
export type AgentWorktreeTarget = {
  subject: AgentWorktreeSubject;
  revision: string;
  candidateId: string;
};
export const AGENT_WORKTREE_SOURCE_LABELS: Record<AgentWorktreeSource, string> =
  {
    foreground_cwd: "Live pane",
    session_cwd: "Session cwd",
    agent_report: "Agent report",
    branch_match: "Branch match",
    worktree_list: "Worktree list",
  };
