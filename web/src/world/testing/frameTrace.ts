export type TimedTraceEvent = { name: string; ts: number };

/** Tracing.start/end also collect frames begun before the measured gesture. */
export function gestureTrace<T extends TimedTraceEvent>(
  events: T[],
  start: string,
  end: string,
): T[] {
  const beginning = events.find((event) => event.name === start);
  const ending = events.find((event) => event.name === end);
  if (!beginning || !ending || ending.ts <= beginning.ts)
    throw new Error("Missing gesture trace boundaries");
  return events.filter(
    (event) => event.ts >= beginning.ts && event.ts <= ending.ts,
  );
}
