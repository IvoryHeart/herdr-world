import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fingerprint, jsonFile, git } from './lib.mjs';
import { evidenceCurrent } from './workflow.mjs';
export { roleEvents, parseResponse } from './workflow.mjs';

export const protectedPaths = /^(?:\.gitignore$|AGENTS\.md$|package(?:-lock)?\.json$|web\/package(?:-lock)?\.json$|\.github\/|\.agents\/skills\/|harness\/|scripts\/|evals\/|(?:web\/)?(?:eslint|vite|vitest|playwright|tsconfig)[^/]*$|(?:bridge|vendor\/herdr-compat)\/(?:Cargo\.(?:toml|lock)|build\.rs)$)/;
export function checkBudget(state, now = Date.now()) {
  if (state.activations >= state.limits.iterations || (state.workflow === 'pair' ? state.remainingMs <= 0 : now >= state.deadline)
    || state.consecutiveFailures >= state.limits.failures) throw new Error('Run budget exhausted');
}
export async function loadState(runDir) { return JSON.parse(await readFile(join(runDir, 'run.json'), 'utf8')); }
export async function saveState(runDir, state) { await jsonFile(join(runDir, 'run.json'), state); }
export async function candidateGate(runDir) {
  const state = await loadState(runDir);
  const current = await fingerprint(join(runDir, 'workspace'));
  if (state.status !== 'ready-for-review' || !evidenceCurrent(state, current)
    || state.verification?.status !== 'passed' || state.verification.fingerprint !== current
    || state.verification.requirementsHash !== state.requirements.hash) throw new Error('Candidate acceptance, QA, review or verification is missing, failed, or stale');
  if (state.workflow === 'pair' && (state.pair?.leadApproval?.fingerprint !== current
    || state.pair.leadApproval.requirementsHash !== state.requirements.hash)) throw new Error('Lead acceptance is missing or stale');
  return state;
}
export function changedPaths(workspace, baseline) {
  const tracked = git(['diff', '--name-only', '-z', baseline], workspace).split('\0').filter(Boolean);
  const added = git(['ls-files', '--others', '--exclude-standard', '-z'], workspace).split('\0').filter(Boolean);
  return [...new Set([...tracked, ...added])];
}
