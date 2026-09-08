import { checkBudget, saveState } from './run-state.mjs';
import { invokeModel } from './model.mjs';
import { parseResponse, acceptResponse } from './workflow.mjs';
import { recordHandover } from './sessions.mjs';

// One model turn per interview round. Waiting for an owner is a saved outcome,
// with no running container and no elapsed-time charge for the human's reply.
export async function conductIntake(runDir, state) {
  const started = Date.now();
  try {
    checkBudget(state);
    state.activations += 1;
    await saveState(runDir, state);
    const turn = await invokeModel(runDir, state, 'intake');
    if (turn.result.interrupted) {
      state.status = 'interrupted'; state.reason = 'Intake interrupted'; return;
    }
    if (turn.result.code !== 0 || turn.sessionError) throw new Error(turn.sessionError ?? 'Intake backend failed; inspect its private turn log');
    const response = parseResponse(turn.output, 'intake');
    acceptResponse(state, 'intake', response, turn.before, turn.after);
    state.turns.at(-1).event = response.event;
    state.intake = { ready: response.event === 'intake.ready', summary: response.summary, questions: response.questions };
    state.lastEvent = state.intake.ready ? 'requirements.ready' : response.event;
    state.status = state.intake.ready ? 'running' : 'blocked';
    state.reason = state.intake.ready ? null : response.summary;
    await recordHandover(runDir, state, 'intake', response, turn.afterTree);
  } catch (error) {
    state.consecutiveFailures += 1;
    state.status = 'failed'; state.reason = error.message;
  } finally {
    if (state.workflow !== 'pair') state.remainingMs = Math.max(0, state.remainingMs - (Date.now() - started));
    if (!state.remainingMs || state.activations >= state.limits.iterations || state.consecutiveFailures >= state.limits.failures) {
      state.status = 'exhausted'; state.reason = 'Execution budget exhausted';
    }
    await saveState(runDir, state);
  }
}
