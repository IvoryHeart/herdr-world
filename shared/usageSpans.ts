/** A closed time span in milliseconds since the epoch: [from, to]. */
export type UsageSpan = [number, number];

/** Spans kept per row or run; past this the closest neighbours join. */
export const USAGE_SPAN_LIMIT = 64;

/**
 * Sorted, joined spans: overlapping ones, and neighbours at most `gap` apart,
 * become one. Past `limit`, the two closest neighbours join, so the result
 * is bounded and still covers every input span (it may only grow).
 */
export function joinUsageSpans(
  spans: readonly (readonly [number, number])[],
  gap = 0,
  limit = USAGE_SPAN_LIMIT,
): UsageSpan[] {
  const sorted = spans
    .filter(([from, to]) => Number.isFinite(from) && Number.isFinite(to))
    .map(([from, to]): UsageSpan => [Math.min(from, to), Math.max(from, to)])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: UsageSpan[] = [];
  for (const span of sorted) {
    const last = out.at(-1);
    if (last && span[0] - last[1] <= gap) last[1] = Math.max(last[1], span[1]);
    else out.push([span[0], span[1]]);
  }
  while (out.length > Math.max(1, limit)) {
    let best = 1;
    for (let i = 2; i < out.length; i++)
      if (out[i]![0] - out[i - 1]![1] < out[best]![0] - out[best - 1]![1])
        best = i;
    out[best - 1]![1] = Math.max(out[best - 1]![1], out[best]![1]);
    out.splice(best, 1);
  }
  return out;
}

/** True when a value is a bounded list of ordered numeric spans. */
export function validUsageSpans(value: unknown, limit = USAGE_SPAN_LIMIT) {
  return (
    Array.isArray(value) &&
    value.length <= limit &&
    value.every(
      (span) =>
        Array.isArray(span) &&
        span.length === 2 &&
        Number.isSafeInteger(span[0]) &&
        Number.isSafeInteger(span[1]) &&
        span[0] >= 0 &&
        span[0] <= span[1],
    )
  );
}
