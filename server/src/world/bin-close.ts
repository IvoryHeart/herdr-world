import type { BinEntry, BinOutcome } from "../../../shared/bin";

type HerdrCall = (
  method: string,
  params: Record<string, unknown>,
  timeoutMs?: number,
) => Promise<unknown>;

/** The runtime a bin entry names, or null when that runtime is gone. */
export type BinLease = {
  generation: number;
  isCurrent: () => boolean;
  call: HerdrCall;
};

type Pane = {
  pane_id: string;
  tab_id: string;
  workspace_id: string;
  terminal_id: string;
};

/**
 * Close a bin entry's pane the way the command palette's Close pane does:
 * pane.close, or workspace.close when it is the workspace's last pane. The pane
 * must still be the same terminal on the same runtime generation; anything
 * else is reported as gone and left alone. A lost reply is read back once and
 * never retried.
 */
export async function closeBinEntry(
  entry: BinEntry,
  lease: BinLease | null,
): Promise<Omit<BinOutcome, "id" | "label" | "view">> {
  if (
    !lease ||
    lease.generation !== entry.connection_generation ||
    !lease.isCurrent()
  )
    return gone("Its host is unavailable, so it was not closed.");
  const before = await listPanes(lease.call);
  const pane = before.find((item) => item.pane_id === entry.pane_id);
  if (
    !pane ||
    pane.terminal_id !== entry.terminal_id ||
    pane.tab_id !== entry.tab_id ||
    pane.workspace_id !== entry.workspace_id
  )
    return gone("It had already closed or moved.");
  const lastInWorkspace =
    before.filter((item) => item.workspace_id === pane.workspace_id).length ===
    1;
  const lastInTab =
    before.filter((item) => item.tab_id === pane.tab_id).length === 1;
  if (!lease.isCurrent())
    return gone("Its host is unavailable, so it was not closed.");
  const method = lastInWorkspace ? "workspace.close" : "pane.close";
  const params = lastInWorkspace
    ? { workspace_id: pane.workspace_id }
    : { pane_id: pane.pane_id };
  try {
    await lease.call(method, params, 30_000);
  } catch (error) {
    if (
      error instanceof Error &&
      /^(workspace_group_close_required|confirmation_required):/.test(
        error.message,
      )
    )
      return {
        result: "failed",
        closed_tab: false,
        detail:
          "Herdr would have closed a worktree group with it, so nothing was closed.",
      };
    // A lost reply can follow a successful close: read back below.
  }
  const after = await listPanes(lease.call).catch(() => null);
  if (after && !after.some((item) => item.pane_id === pane.pane_id))
    return { result: "closed", closed_tab: lastInTab };
  return {
    result: "failed",
    closed_tab: false,
    detail: "The close was sent but the agent is still open.",
  };
}

function gone(detail: string): Omit<BinOutcome, "id" | "label" | "view"> {
  return { result: "gone", closed_tab: false, detail };
}

async function listPanes(call: HerdrCall): Promise<Pane[]> {
  const result = (await call("pane.list", {}, 5_000)) as {
    panes?: Partial<Pane>[];
  };
  return (result?.panes ?? []).filter(
    (pane): pane is Pane =>
      typeof pane.pane_id === "string" &&
      typeof pane.terminal_id === "string" &&
      typeof pane.tab_id === "string" &&
      typeof pane.workspace_id === "string",
  );
}

type LeaseSource = {
  readyRuntimeLease(connectionId: string):
    | {
        generation: number;
        isCurrent(): boolean;
        runtime: { herdr: { call: HerdrCall } };
      }
    | null
    | undefined;
};

/** The bin's close, run on the entry's own connection's current runtime. */
export function binCloser(connections: () => LeaseSource) {
  return (entry: BinEntry) => {
    const lease = connections().readyRuntimeLease(entry.connection_id);
    return closeBinEntry(
      entry,
      lease
        ? {
            generation: lease.generation,
            isCurrent: () => lease.isCurrent(),
            call: (method, params, timeoutMs) =>
              lease.runtime.herdr.call(method, params, timeoutMs),
          }
        : null,
    );
  };
}
