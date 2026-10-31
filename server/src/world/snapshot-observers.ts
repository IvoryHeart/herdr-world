type Row = Record<string, unknown>;
export type Fresh = (
  connectionId: string,
  generation: number,
  panes: readonly Row[],
  observedAt: number,
  agents: readonly Row[],
) => void;
export type Complete = (
  connectionId: string,
  generation: number,
  panes: readonly Row[],
) => void;

/** A presentation bound or malformed reply cannot witness terminal absence. */
export function complete(
  observer: Complete | undefined,
  lease: { connectionId: string; generation: number },
  value: unknown,
) {
  const panes = (value as { panes?: unknown } | null)?.panes;
  if (Array.isArray(panes))
    observer?.(
      lease.connectionId,
      lease.generation,
      panes.filter(
        (row): row is Row =>
          !!row && typeof row === "object" && !Array.isArray(row),
      ),
    );
}
