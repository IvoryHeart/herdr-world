import { candidateGate } from './run-state.mjs';
import { errorExit } from './lib.mjs';
try {
  if (!process.env.WORLD_AGENT_RUN) throw new Error('Use agent:run; a run directory is required');
  await candidateGate(process.env.WORLD_AGENT_RUN);
} catch (error) { errorExit(error); }
