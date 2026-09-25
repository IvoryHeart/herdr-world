import { EndpointClient } from "../bridge/endpoint-client";
import type { SemanticNotification } from "../bridge/semantic-notification";
import type { TaskEvent } from "./task-events";

/**
 * Where task notifications come from.
 * - `herdr`: Herdr's SemanticNotification stream, so World alerts follow the
 *   same policy as Herdr's own toasts (external-agent suppression, observer
 *   alerts sent with `herdr notification show`).
 * - `status`: World's own working -> idle/done/blocked status tracker.
 */
export type TaskNotificationSource = "herdr" | "status";

export function parseTaskNotificationSource(
  value: string | undefined,
): TaskNotificationSource {
  const normalized = (value ?? "herdr").trim().toLowerCase();
  if (normalized === "herdr" || normalized === "status") return normalized;
  throw new Error(
    `Invalid notification source "${value}" (expected herdr or status)`,
  );
}

/** Map Herdr's semantic kinds onto the existing completed/blocked preferences. */
export function taskEventFromSemanticNotification(
  notification: SemanticNotification,
): TaskEvent | null {
  let kind: TaskEvent["kind"];
  switch (notification.kind) {
    case "finished":
      kind = "completed";
      break;
    case "needs_attention":
      kind = "blocked";
      break;
    case "custom":
      // `herdr notification show` carries no kind; its sound says which one.
      kind = notification.sound === "request" ? "blocked" : "completed";
      break;
    default:
      return null;
  }
  return {
    kind,
    agent: notification.agent ?? "Agent",
    title: notification.title,
    ...(notification.body ? { body: notification.body } : {}),
    ...(notification.workspaceId
      ? { workspaceId: notification.workspaceId }
      : {}),
    ...(notification.tabId ? { tabId: notification.tabId } : {}),
    ...(notification.paneId ? { paneId: notification.paneId } : {}),
  };
}

type ListenerClient = Pick<EndpointClient, "connect" | "close" | "on">;

const INITIAL_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;
// Surface size is irrelevant for a passive shell but must be non-zero.
const PASSIVE_COLS = 80;
const PASSIVE_ROWS = 24;

/**
 * Keeps one passive endpoint shell connected to Herdr and forwards every
 * SemanticNotification it receives. Reconnects with capped backoff.
 */
export function createHerdrNotificationListener(args: {
  clientSocketPath: string;
  onNotification: (notification: SemanticNotification) => void;
  /**
   * Whether the server speaks endpoint generation 1. Legacy servers never
   * receive an endpoint hello; they are re-checked at the maximum retry delay
   * in case Herdr is upgraded in place.
   */
  isAvailable?: () => Promise<boolean>;
  onUnavailable?: () => void;
  onConnected?: () => void;
  onError?: (error: Error) => void;
  createClient?: (socketPath: string) => ListenerClient;
  initialRetryMs?: number;
  maxRetryMs?: number;
}) {
  const createClient =
    args.createClient ??
    ((socketPath: string) =>
      new EndpointClient(socketPath, false, "notifications"));
  const initialRetryMs = args.initialRetryMs ?? INITIAL_RETRY_MS;
  const maxRetryMs = args.maxRetryMs ?? MAX_RETRY_MS;
  let running = false;
  let client: ListenerClient | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryMs = initialRetryMs;
  // Invalidates availability checks that settle after stop() or a restart.
  let epoch = 0;

  function scheduleRetry(delayMs = retryMs) {
    retryTimer = setTimeout(connect, delayMs);
    retryMs = Math.min(retryMs * 2, maxRetryMs);
  }

  function report(error: unknown) {
    try {
      args.onError?.(error instanceof Error ? error : new Error(String(error)));
    } catch {
      // Observers must not stop reconnect processing.
    }
  }

  function connect() {
    retryTimer = null;
    if (!running) return;
    if (!args.isAvailable) return open();
    const started = epoch;
    args.isAvailable().then(
      (available) => {
        if (!running || started !== epoch) return;
        if (available) return open();
        args.onUnavailable?.();
        scheduleRetry(maxRetryMs);
      },
      (error) => {
        if (!running || started !== epoch) return;
        report(error);
        scheduleRetry();
      },
    );
  }

  function open() {
    const current = createClient(args.clientSocketPath);
    client = current;
    let finished = false;
    const retry = (error: unknown) => {
      if (finished) return;
      finished = true;
      if (client === current) client = null;
      current.close();
      if (!running) return;
      report(error);
      scheduleRetry();
    };
    current.on(
      "semantic_notification",
      (notification: SemanticNotification) => {
        if (!running || client !== current) return;
        try {
          args.onNotification(notification);
        } catch (error) {
          report(error);
        }
      },
    );
    current.on("notification_error", (error: Error) => report(error));
    current.on("error", (error: Error) => retry(error));
    current.on("close", () =>
      retry(new Error("Herdr notification shell disconnected")),
    );
    current.connect(PASSIVE_COLS, PASSIVE_ROWS).then(
      () => {
        if (finished || !running || client !== current) return;
        retryMs = initialRetryMs;
        try {
          args.onConnected?.();
        } catch {
          // Observers must not stop notification delivery.
        }
      },
      (error) => retry(error),
    );
  }

  return {
    start() {
      if (running) return;
      running = true;
      retryMs = initialRetryMs;
      connect();
    },
    stop() {
      running = false;
      epoch++;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      const current = client;
      client = null;
      current?.close();
    },
    isRunning: () => running,
  };
}

export type HerdrNotificationListener = ReturnType<
  typeof createHerdrNotificationListener
>;
