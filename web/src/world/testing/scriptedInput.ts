/** Finite behaviour workload; native cadence remains in the performance lane. */
export const SCRIPTED_INPUT_COUNT = 16;

export async function scriptedInput(
  emit: (sequence: number) => Promise<void>,
  count = SCRIPTED_INPUT_COUNT,
) {
  for (let sequence = 0; sequence < count; sequence++) await emit(sequence);
}

/** Native cadence is measured only by the latency/tracing entry points. */
export function nativeInputMode(env: Record<string, string | undefined>) {
  return env.WORLD_LATENCY_TREND_FILE || env.WORLD_TRACE_PREFIX
    ? "independent"
    : "scripted";
}
