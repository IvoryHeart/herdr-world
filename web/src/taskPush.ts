import { prepareTaskNotifications } from "./taskNotifications";

export interface TaskNotificationPreferences {
  completed: boolean;
  blocked: boolean;
}

async function pushRequest(method: "GET" | "POST" | "DELETE", body?: unknown) {
  const response = await fetch("/api/notifications/push", {
    method,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Herdr-World-Push": "1",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(
      "Unable to update background notifications. Check the server connection and try again.",
    );
  return response.json() as Promise<{
    available?: boolean;
    publicKey?: string;
  }>;
}

let updates: Promise<unknown> = Promise.resolve();
let pendingRestore: AbortController | undefined;
let invalidStateTrial = false;

/** Testing only: consume the URL switch before view routing rewrites it. */
export function taskPushSyncTrial(search: string) {
  invalidStateTrial =
    new URLSearchParams(search).get("notificationSync") === "invalid-state";
  if (!invalidStateTrial || typeof history === "undefined") return;
  const url = new URL(location.href);
  url.searchParams.delete("notificationSync");
  history.replaceState(history.state, "", url);
}
if (typeof location !== "undefined") taskPushSyncTrial(location.search);

function deferRestore(retry: () => void) {
  pendingRestore?.abort();
  const lifecycle = new AbortController();
  pendingRestore = lifecycle;
  const resume = () => {
    if (document.visibilityState !== "visible") return;
    lifecycle.abort();
    pendingRestore = undefined;
    retry();
  };
  document.addEventListener("visibilitychange", resume, {
    signal: lifecycle.signal,
  });
  window.addEventListener("pageshow", resume, { signal: lifecycle.signal });
  document.addEventListener("resume", resume, { signal: lifecycle.signal });
}

/** Passive sync waits for a visible, active document; explicit settings still report failures. */
export async function restoreTaskPush(
  enabled: boolean,
  preferences: TaskNotificationPreferences,
  retry: () => void,
): Promise<"push" | "local" | null> {
  if (
    typeof document !== "undefined" &&
    document.visibilityState === "hidden"
  ) {
    deferRestore(retry);
    return null;
  }
  pendingRestore?.abort();
  pendingRestore = undefined;
  try {
    // Local browser alerts also use the worker on browsers without Web Push.
    if (enabled && typeof window !== "undefined" && !("PushManager" in window))
      await prepareTaskNotifications();
    return await syncTaskPush(enabled, preferences);
  } catch (error) {
    if (
      typeof document !== "undefined" &&
      error !== null &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "InvalidStateError"
    ) {
      deferRestore(retry);
      return null;
    }
    throw error;
  }
}

/** Serialize subscription changes so a late enable cannot undo a device revocation. */
export function syncTaskPush(
  enabled: boolean,
  preferences: TaskNotificationPreferences,
  allowSubscribe = false,
): Promise<"push" | "local"> {
  const task = updates
    .catch(() => {})
    .then(async () => {
      if (invalidStateTrial) {
        invalidStateTrial = false;
        throw new DOMException("Document is not active", "InvalidStateError");
      }
      if (
        typeof navigator === "undefined" ||
        !navigator.serviceWorker ||
        !("PushManager" in window)
      )
        return "local" as const;
      const registration = enabled
        ? await prepareTaskNotifications()
        : await navigator.serviceWorker.getRegistration("/");
      if (!registration?.pushManager) return "local" as const;
      let subscription = await registration.pushManager.getSubscription();
      if (!enabled) {
        if (subscription) {
          // Persist revocation first; offline errors must not look like successful removal.
          await pushRequest("DELETE", { endpoint: subscription.endpoint });
          if (!(await subscription.unsubscribe()))
            throw new Error(
              "The browser could not revoke its push subscription. Try again.",
            );
        }
        return "local" as const;
      }
      const config = await pushRequest("GET");
      if (!config.available || !config.publicKey) {
        if (subscription && !(await subscription.unsubscribe()))
          throw new Error("Unable to disable the previous push subscription.");
        return "local" as const;
      }
      const applicationServerKey = Uint8Array.from(
        atob(config.publicKey.replace(/-/g, "+").replace(/_/g, "/")),
        (char) => char.charCodeAt(0),
      );
      if (
        subscription?.options.applicationServerKey &&
        new Uint8Array(subscription.options.applicationServerKey).some(
          (byte, index) => byte !== applicationServerKey[index],
        )
      ) {
        await pushRequest("DELETE", { endpoint: subscription.endpoint });
        if (!(await subscription.unsubscribe()))
          throw new Error("Unable to replace the previous push subscription.");
        subscription = null;
      }
      let created = false;
      if (!subscription && allowSubscribe) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
        created = true;
      }
      if (!subscription) return "local" as const;
      try {
        await pushRequest("POST", {
          subscription: subscription.toJSON(),
          preferences,
        });
      } catch (error) {
        if (created) await subscription.unsubscribe();
        throw error;
      }
      return "push" as const;
    });
  updates = task;
  return task;
}
