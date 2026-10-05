import { CREATED_PANE_ADMISSION_TIMEOUT_MS } from "./officeRoomActions";

export function createdTerminalIdentity(result: unknown) {
  if (!result || typeof result !== "object") return null;
  const pane = (result as { root_pane?: unknown }).root_pane;
  if (!pane || typeof pane !== "object") return null;
  const { pane_id, terminal_id, workspace_id, tab_id } = pane as Record<
    string,
    unknown
  >;
  if (
    typeof pane_id !== "string" ||
    !pane_id ||
    typeof terminal_id !== "string" ||
    !terminal_id ||
    typeof workspace_id !== "string" ||
    !workspace_id ||
    typeof tab_id !== "string" ||
    !tab_id
  )
    return null;
  return {
    paneId: pane_id,
    terminalId: terminal_id,
    workspaceId: workspace_id,
    tabId: tab_id,
  };
}

/** Wake on relevant observations; never repeatedly dispatch focus on a timer. */
export function admitCreatedTerminal({
  subscribe,
  current,
  open,
  observe,
  signal,
  timeoutMs = CREATED_PANE_ADMISSION_TIMEOUT_MS,
}: {
  subscribe(listener: () => void): () => void;
  current(): {
    available: boolean;
    observation: string;
    invalidReason?: string;
  };
  open(signal: AbortSignal): Promise<void>;
  observe(): Promise<unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  return new Promise<void>((resolve, reject) => {
    const abort = new AbortController();
    let settled = false;
    let opening = false;
    let attemptedObservation: string | null = null;
    let lastFailure =
      "The created terminal was not admitted within the World snapshot window.";
    let unsubscribe = () => {};
    const timer = setTimeout(() => finish(new Error(lastFailure)), timeoutMs);
    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      signal?.removeEventListener("abort", cancelled);
      abort.abort();
      if (error) reject(error);
      else resolve();
    }
    function cancelled() {
      finish(new Error("Terminal activation was superseded"));
    }
    function check() {
      if (settled) return;
      const state = current();
      if (state.invalidReason) return finish(new Error(state.invalidReason));
      if (opening) return;
      if (!state.available || state.observation === attemptedObservation)
        return;
      attemptedObservation = state.observation;
      opening = true;
      void open(abort.signal)
        .then(
          () => finish(),
          (error) => {
            lastFailure = String(error);
          },
        )
        .finally(() => {
          opening = false;
          check();
        });
    }
    unsubscribe = subscribe(check);
    signal?.addEventListener("abort", cancelled, { once: true });
    if (signal?.aborted) return cancelled();
    check();
    void observe().then(check, (error) => {
      lastFailure = String(error);
    });
  });
}
