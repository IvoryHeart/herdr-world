// Live persistence regression: actual pinned Codex, recreated Docker containers,
// synthetic source and no access to the owner's working tree or deployments.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { command, git, repoRoot, fingerprint, jsonFile, primaryCheckout } from '../scripts/agent/lib.mjs';
import { writeSchemas } from '../scripts/agent/run.mjs';
import { resolveModels, parseResponse, acceptResponse } from '../scripts/agent/workflow.mjs';
import { invokeModel } from '../scripts/agent/model.mjs';
import { conductIntake } from '../scripts/agent/intake.mjs';
import { recordHandover, sessionGroups } from '../scripts/agent/sessions.mjs';
import { budgetPolicy } from '../scripts/agent/budgets.mjs';
import { recoverUsage } from '../scripts/agent/usage.mjs';
import { telemetryConfig, localTelemetryEndpoint, flushTelemetry } from '../scripts/agent/telemetry.mjs';
import { saveState } from '../scripts/agent/run-state.mjs';

const parent = join(repoRoot, '.agents/state/session-evals');
await mkdir(parent, { recursive: true });
const runDir = await mkdtemp(join(parent, 'live-'));
const workspace = join(runDir, 'workspace'), control = join(runDir, 'control');
await mkdir(join(workspace, '.ralph/agent'), { recursive: true });
await cp(join(repoRoot, 'harness/roles'), join(control, 'harness/roles'), { recursive: true });
await cp(join(repoRoot, 'scripts/agent'), join(control, 'scripts/agent'), { recursive: true });
await writeSchemas(control);
await writeFile(join(workspace, '.gitignore'), '.ralph/\n.agents/\n');
await writeFile(join(workspace, 'AGENTS.md'), 'This synthetic evaluation has one pure helper. Inspect source directly; no installs or external research are needed. Return only the role response.\n');
await writeFile(join(workspace, 'source.mjs'), 'export function delay(attempt) { return Math.min(5000, 1000 * 2 ** attempt); }\n');
git(['init', '-b', 'candidate'], workspace); git(['add', '.'], workspace);
git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture'], workspace);
const inspect = await command(['docker', 'image', 'inspect', 'herdr-world-agent:1', '--format', '{{.Id}}'], { stream: false });
assert.equal(inspect.code, 0, inspect.output);
const state = { schemaVersion: 4, id: randomUUID(), status: 'running', image: inspect.stdout.trim(),
  authFile: join(homedir(), '.codex/auth.json'), models: resolveModels(JSON.parse(await readFile(join(repoRoot, 'harness/models.json')))),
  sessionMode: 'persistent', sessionGroups, sessions: {}, turns: [], activations: 0, consecutiveFailures: 0,
  limits: { iterations: 12, failures: 3, seconds: 1800 }, budgets: budgetPolicy(1800),
  startedAt: new Date().toISOString(), remainingMs: 1800000, deadline: Date.now() + 1800000,
  telemetry: telemetryConfig(process.env.WORLD_AGENT_OTEL_ENDPOINT ?? await localTelemetryEndpoint(primaryCheckout())),
  taskProfile: 'feature', intake: { ready: false }, task: 'Adjust the retry delay helper in source.mjs. The first retry (attempt 0) must be immediate, later retries must double from 1000ms, and there must be a cap. The product owner has not supplied the cap: ask for that decision before declaring intake ready.' };
const report = { kind: 'live-session-regression', sourceRevision: git(['rev-parse', 'HEAD'], repoRoot),
  harnessFingerprint: await fingerprint(repoRoot), image: state.image, startedAt: new Date().toISOString(), assertions: [] };
console.log('Live session evidence: ' + runDir);
try {
  await conductIntake(runDir, state);
  assert.equal(state.status, 'blocked', state.reason); assert(state.intake.questions.length);
  report.assertions.push('Intake requested missing owner decision');
  const leadId = state.sessions.lead.threadId;
  state.task += '\nOwner clarification: cap at 8000ms.'; state.status = 'running';
  await conductIntake(runDir, state);
  assert.equal(state.status, 'running', state.reason); assert(state.intake.ready);
  assert.equal(state.sessions.lead.threadId, leadId);
  report.assertions.push('Intake resumed the exact native thread after owner answer and container recreation');
  state.task = 'Implement and review source.mjs: delay(0) must be 0, delay(1) 1000, delay(2) 2000, and all larger delays cap at 8000. Scope is only this helper; no external research or dependency setup is needed.';
  state.requirements = null;
  acceptResponse(state, 'planner', { event: 'plan.ready', summary: 'Check immediate retry and cap.', specialists: [],
    acceptance: [{ id: 'retry', criterion: state.task }] }, 'same', 'same');
  acceptResponse(state, 'qa-planner', { event: 'qa.planned', summary: 'Exercise boundary values.',
    scenarios: [{ id: 'bounds', acceptanceIds: ['retry'], steps: 'Evaluate delay(0), delay(1), delay(2), delay(10).', expected: '0, 1000, 2000, 8000.' }] }, 'same', 'same');
  async function turn(role) {
    state.activations++; const value = await invokeModel(runDir, state, role);
    assert.equal(value.result.code, 0, value.result.stderr); assert.equal(value.sessionError, null);
    const response = parseResponse(value.output, role);
    acceptResponse(state, role, response, value.before, value.after);
    await recordHandover(runDir, state, role, response, value.afterTree);
    report.responses ??= []; report.responses.push({ role, ...response });
    return response;
  }
  assert.equal((await turn('implementer')).event, 'candidate.ready');
  assert.equal(state.sessions.lead.threadId, leadId);
  report.assertions.push('Lead continued from read-only intake to writable implementation in the exact same history');
  acceptResponse(state, 'planner', { event: 'oracle.requested', summary: 'Inspect source.mjs only. Does the first retry and exponent offset satisfy the stated 0/1000/2000/8000 sequence? Give a falsifiable boundary check, without broader research.' }, 'same', 'same');
  assert.equal((await turn('oracle')).event, 'oracle.advised');
  assert.notEqual(state.sessions.oracle.threadId, leadId);
  report.assertions.push('Focused Oracle advice used a separate history and returned to the requesting phase');
  // Seed an old defect followed by a different defect; review must do more than close prior findings.
  await writeFile(join(workspace, 'source.mjs'), 'export function delay(attempt) { return attempt === 0 ? 0 : Math.min(5000, 1000 * 2 ** (attempt - 1)); }\n');
  const first = await turn('reviewer'); assert.equal(first.event, 'review.rejected');
  const reviewId = state.sessions.review.threadId;
  state.feedback = { role: 'reviewer', ...first };
  await writeFile(join(workspace, 'source.mjs'), 'export function delay(attempt) { return Math.min(8000, 1000 * 2 ** Math.max(0, attempt - 1)); }\n');
  const second = await turn('reviewer'); assert.equal(second.event, 'review.rejected');
  assert.equal(state.sessions.review.threadId, reviewId);
  assert.match(second.summary, /(?:attempt\s*(?:===?\s*)?0|delay\(0\)|immediate|first retry)/i);
  report.assertions.push('Same reviewer rejected a new defect after the original defect was repaired');
  await writeFile(join(workspace, 'source.mjs'), 'export function delay(attempt) { return attempt === 0 ? 0 : Math.min(8000, 1000 * 2 ** (attempt - 1)); }\n');
  const third = await turn('reviewer'); assert.equal(third.event, 'review.passed');
  const qa = await turn('qa'); assert.equal(qa.event, 'qa.passed');
  assert.equal(state.sessions.review.threadId, reviewId);
  assert.equal(state.turns.at(-1).model, 'gpt-5.6-sol');
  assert.equal(state.turns.at(-1).reasoningEffort, 'high');
  report.assertions.push('Repaired candidate passed review and QA in the same independent Sol high history with the current schema');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.message; process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString(); report.turns = state.turns;
  state.finishedAt = report.finishedAt; state.status = report.status;
  await saveState(runDir, state);
  report.usage = await recoverUsage(runDir, { interrupted: true });
  report.telemetry = await flushTelemetry(runDir, state.telemetry);
  await jsonFile(join(runDir, 'report.json'), report);
  console.log(JSON.stringify(report, null, 2));
}
