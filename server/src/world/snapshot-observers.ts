type Row = Record<string, unknown>;
export type Fresh = (
  connectionId: string,
  generation: number,
  panes: readonly Row[],
  observedAt: number,
  agents: readonly Row[],
  topology?: { workspaces?: readonly Row[]; tabs?: readonly Row[] },
) => void;
export type Complete = (
  connectionId: string,
  generation: number,
  panes: readonly Row[],
  /** When the read began (wall clock, ms): it witnesses nothing earlier. */
  readAt: number,
) => void;

/** A presentation bound or malformed reply cannot witness terminal absence. */
export function complete(
  observer: Complete | undefined,
  lease: { connectionId: string; generation: number },
  value: unknown,
  readAt: number,
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
      readAt,
    );
}
