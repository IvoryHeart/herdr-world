import { serverLogger } from "../utils/logger";

export function describeListenerStartError(
  error: unknown,
  host: string,
  port: number,
): Error {
  const cause = error instanceof Error ? error : new Error(String(error));
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code !== "EADDRINUSE" && !/port .* in use/i.test(cause.message)) {
    return cause;
  }
  return new Error(
    `Cannot listen on ${host}:${port}: the port is already in use. ` +
      "Stop the old World process before upgrading, or choose a free port " +
      "with --port (PORT in the preserved herdr-world.env for a managed service). " +
      "World will not move to another port automatically.",
  );
}

export function bindListenerBeforeConnectionStart<Listener>(args: {
  bindListener: () => Listener;
  startConnection: () => void | Promise<void>;
  onConnectionError: (error: unknown) => void;
}): Listener {
  const listener = args.bindListener();
  const reportConnectionError = (error: unknown) => {
    try {
      args.onConnectionError(error);
    } catch (observerError) {
      serverLogger
        .child("connections")
        .error("connection startup error observer failed", {
          error: observerError,
        });
    }
  };
  try {
    void Promise.resolve(args.startConnection()).catch(reportConnectionError);
  } catch (error) {
    reportConnectionError(error);
  }
  return listener;
}
