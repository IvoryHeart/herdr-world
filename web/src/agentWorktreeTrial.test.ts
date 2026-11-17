import { expect, test } from "bun:test";
import type { AgentWorktreeObservation } from "../../shared/agentWorktree";
import {
  __setWorktreeChangeTrialForTests,
  worktreeChangeTrial,
} from "./agentWorktreeTrial";

const resolved: AgentWorktreeObservation = {
  subject: {
    connectionId: "alpha",
    generation: 7,
    paneId: "pane",
    sessionFingerprint: null,
  },
  revision: "revision",
  observedAt: "2026-01-01T00:00:00Z",
  state: "resolved",
  selectedCandidateId: "root",
  candidates: [
    {
      candidateId: "root",
      canonicalRoot: "/project/root",
      gitCommonDir: "/project/root/.git",
      gitIdentity: "root",
      branch: "main",
      source: "foreground_cwd",
      evidence: {
        sourceRef: "Synthetic observation",
        observedAt: "2026-01-01T00:00:00Z",
        basis: "reported",
      },
    },
  ],
};

test("without ?worktreeChanged, observations pass through", () => {
  __setWorktreeChangeTrialForTests("?view=town");
  expect(worktreeChangeTrial(resolved)).toBe(resolved);
});

test("?worktreeChanged turns the first observation with candidates stale, once", () => {
  __setWorktreeChangeTrialForTests("?worktreeChanged");
  const empty = { ...resolved, candidates: [], state: "unavailable" as const };
  expect(worktreeChangeTrial(empty)).toBe(empty);
  const changed = worktreeChangeTrial(resolved);
  expect(changed.state).toBe("stale");
  expect(changed.candidates).toEqual(resolved.candidates);
  expect(changed.selectedCandidateId).toBe("root");
  // Opening Files reads the worktree again and gets the real answer.
  expect(worktreeChangeTrial(resolved)).toBe(resolved);
});
