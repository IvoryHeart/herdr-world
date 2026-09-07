// Cumulative stage ceilings survive retries/resume. Time awaiting owner input is excluded.
export const stages = {
  intake: 'preparation', product: 'preparation', planner: 'preparation', 'qa-planner': 'preparation',
  implementer: 'implementation', reviewer: 'review', qa: 'review', oracle: 'advice', verifier: 'verification',
};
export function budgetPolicy(seconds) {
  return {
    stages: Object.fromEntries(Object.entries({ preparation: .15, advice: .05, implementation: .45, review: .20, verification: .15 })
      .map(([stage, share]) => [stage, Math.floor(seconds * 1000 * share)])),
    turnCaps: { intake: 180000, product: 90000, planner: 120000, 'qa-planner': 90000, oracle: 180000 },
    graceMs: 10000,
  };
}
export function stageAllowance(state, role, attempts = [], now = Date.now()) {
  const stage = stages[role];
  if (!stage) throw new Error('Unknown budget stage for ' + role);
  // Old frozen runs keep their original execution policy.
  if (!state.budgets) return { stage, timeoutMs: Math.min(900000, Math.max(0, state.deadline - now)), graceMs: 0 };
  const spentMs = attempts.filter(a => a.stage === stage).reduce((n, a) => n + a.elapsedMs, 0);
  const timeoutMs = Math.max(0, Math.min(state.deadline - now,
    state.budgets.stages[stage] - spentMs, state.budgets.turnCaps[role] ?? Infinity));
  return { stage, spentMs, timeoutMs, graceMs: Math.min(state.budgets.graceMs, timeoutMs / 10) };
}
