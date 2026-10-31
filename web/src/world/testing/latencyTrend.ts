import { appendFileSync } from "node:fs";

/**
 * Timing from the World browser suites, for the non-blocking World latency
 * trend job. Wall-clock numbers depend on the runner, so suites record them
 * here and never assert them; the trend report compares them with main.
 */
export function recordLatency(
  suite: string,
  label: string,
  metrics: Record<string, number>,
) {
  const file = Bun.env.WORLD_LATENCY_TREND_FILE;
  if (file)
    appendFileSync(
      file,
      JSON.stringify({
        suite,
        case: label,
        // The trend compares like with like: CI runners differ by CPU model.
        cpu: Bun.env.WORLD_LATENCY_TREND_CPU || null,
        metrics,
      }) + "\n",
    );
}
