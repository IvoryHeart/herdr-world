// Pair routing is a small policy adapter; Ralph still owns the event loop.
export const otherPartner = role => role === 'pair-a' ? 'pair-b' : 'pair-a';
export const partnerEvent = role => role === 'pair-b' ? 'pair.b' : 'pair.a';
export function pairCurrent(state, current) {
  const pair = state.pair;
  return Boolean(state.requirements?.hash && pair?.proposal?.fingerprint === current
    && pair.approval?.fingerprint === current && pair.approval.requirementsHash === state.requirements.hash
    && pair.approval.role !== pair.proposal.role && pair.approval.activation > pair.proposal.activation);
}
export function acceptPairResponse(state, role, response, before, after) {
  const pair = state.pair ??= {};
  const edited = before !== after;
  if (edited) { pair.lastWriter = role; pair.approval = null; pair.leadApproval = null; }
  if (role === 'lead') {
    if (edited) throw new Error('Lead acceptance cannot edit the candidate');
    if (response.event === 'lead.accepted') {
      if (!pairCurrent(state, after) || state.verification?.status !== 'passed'
        || state.verification.fingerprint !== after) throw new Error('Lead acceptance requires reviewed, verified source');
      pair.leadApproval = { fingerprint: after, activation: state.activations, requirementsHash: state.requirements.hash };
      state.status = 'ready-for-review';
      return { event: 'candidate.verified', summary: response.summary };
    }
    if (response.event === 'lead.resume') {
      pair.approval = null; pair.leadApproval = null;
      state.feedback = { role, ...response };
      return { event: partnerEvent(pair.returnTo ?? 'pair-a'), summary: response.summary };
    }
    return response;
  }
  if (['task.blocked', 'oracle.requested'].includes(response.event)) return response;
  if (response.event === 'lead.requested') {
    pair.returnTo = role;
    state.feedback = { role, ...response };
    return { event: 'lead.start', summary: response.summary };
  }
  if (!state.requirements?.criteria?.length) throw new Error('Pair needs an accepted task brief');
  if (!Array.isArray(response.findings) || response.findings.some(f => !f.id?.trim() || !f.detail?.trim())
    || new Set(response.findings.map(f => f.id)).size !== response.findings.length) throw new Error('Findings need stable unique IDs and concrete details');
  state.feedback = { role, ...response };
  if (response.event === 'pair.accepted') {
    const ids = state.requirements.criteria.map(c => c.id);
    if (edited || response.findings.length || pair.proposal?.role === role || pair.proposal?.fingerprint !== after
      || pair.proposal.activation >= state.activations) throw new Error('Only the other partner can accept an unchanged proposal');
    if (!Array.isArray(response.evidence) || response.evidence.length !== ids.length
      || new Set(response.evidence.map(e => e.acceptanceId)).size !== ids.length
      || response.evidence.some(e => !ids.includes(e.acceptanceId) || !e.evidence?.trim())) throw new Error('Acceptance needs behavioral evidence for every criterion');
    pair.approval = { role, fingerprint: after, activation: state.activations, requirementsHash: state.requirements.hash, evidence: response.evidence };
    pair.stalls = 0; pair.lastProblem = null; pair.handoffs = 0; pair.returnTo = pair.proposal.role;
    return { event: 'pair.agreed', summary: response.summary };
  }
  // A changed fingerprint alone is not progress: count repeated unresolved findings,
  // or empty unchanged handoffs, rather than resetting the governor on any edit.
  pair.handoffs = (pair.handoffs ?? 0) + 1;
  if (pair.handoffs >= 6) {
    pair.returnTo = otherPartner(role);
    if (pair.churnEscalated) return { event: 'task.blocked', summary: 'Pair did not reach acceptance after lead intervention; inspect repeated correction/scope churn.' };
    pair.churnEscalated = true; pair.handoffs = 2;
    return { event: 'lead.start', summary: 'Six handoffs without acceptance. Lead: assess missing evidence, scope churn or approach before another correction.' };
  }
  const problem = response.findings.map(f => f.id).sort().join(',') || (!edited ? 'unchanged-handoff' : null);
  pair.stalls = problem && problem === pair.lastProblem ? (pair.stalls ?? 0) + 1 : 0;
  pair.lastProblem = problem;
  if (pair.stalls >= 2) {
    if (pair.escalatedProblem === problem) return { event: 'task.blocked', summary: 'Pair repeated the same unresolved issue after lead guidance: ' + problem };
    pair.escalatedProblem = problem; pair.stalls = 0; pair.returnTo = otherPartner(role);
    return { event: 'lead.start', summary: 'Pair needs guidance after repeated unresolved handoffs: ' + problem };
  }
  if (edited || !pair.proposal || pair.proposal.fingerprint !== after) pair.proposal = { role, fingerprint: after, activation: state.activations };
  pair.returnTo = otherPartner(role);
  return { event: partnerEvent(otherPartner(role)), summary: response.summary };
}
