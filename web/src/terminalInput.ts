import { type ConnectionClient, UncertainRequestError } from "./api";
import { store } from "./store";

const reported = new Map<string, number>();
const NOTICE_INTERVAL_MS = 3000;

/** Capture the original owner before dispatch; retirement must not hide uncertainty. */
export async function runTerminalInput<T>(
  client: ConnectionClient,
  dispatch: () => Promise<T>,
): Promise<T> {
  const label =
    store
      .get()
      .connections.find((connection) => connection.id === client.connectionId)
      ?.label ?? client.connectionId;
  try {
    return await dispatch();
  } catch (error) {
    const uncertain = error instanceof UncertainRequestError;
    const key =
      client.connectionId +
      ":" +
      client.serverRuntimeGeneration +
      ":" +
      client.generation;
    const now = Date.now();
    const previousUncertainty = reported.get(key);
    if (
      !uncertain ||
      previousUncertainty === undefined ||
      now - previousUncertainty >= NOTICE_INTERVAL_MS
    ) {
      if (uncertain) {
        reported.set(key, now);
        if (reported.size > 64) reported.delete(reported.keys().next().value!);
      } else {
        reported.delete(key);
      }
      store.notify({
        kind: "error",
        message: uncertain
          ? "Terminal input outcome is uncertain"
          : "Terminal input was not sent",
        detail:
          label +
          (uncertain
            ? ": the input may have reached its original runtime. It was not replayed. Refresh and verify that exact terminal before deciding whether to retry."
            : ": refresh the original terminal before trying again."),
      });
    }
    throw error;
  }
}

export function sendTerminalInput(
  client: ConnectionClient,
  bytes: Uint8Array,
  terminalId: string,
) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return runTerminalInput(client, () =>
    client.call("terminal.input", {
      terminal_id: terminalId,
      data: btoa(text),
    }),
  );
}
