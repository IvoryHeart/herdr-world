self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function validNotificationTarget(target) {
  if (!target || typeof target !== "object" || Array.isArray(target))
    return false;
  if (target.type === "ranger_task") {
    const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
    return (
      typeof target.taskId === "string" &&
      uuid.test(target.taskId) &&
      typeof target.runId === "string" &&
      uuid.test(target.runId)
    );
  }
  return (
    !("type" in target) &&
    typeof target.connectionId === "string" &&
    target.connectionId &&
    Number.isSafeInteger(target.runtimeGeneration) &&
    target.runtimeGeneration >= 0 &&
    typeof target.workspaceId === "string" &&
    target.workspaceId &&
    typeof target.paneId === "string" &&
    target.paneId
  );
}

// Any fresh playing or muted page silences push. Track each page separately,
// so a suspended tab cannot override another tab that owns the sound.
const chimePolicies = new Map();
self.addEventListener("message", (event) => {
  const data = event.data;
  if (
    (data?.type === "herdr-world:chimes-active" ||
      (data?.type === "herdr-world:chime-policy" &&
        ["playing", "muted", "fallback"].includes(data.mode))) &&
    Number.isFinite(data.until) &&
    data.until <= Date.now() + 60_000
  ) {
    const key = event.source?.id ?? "legacy";
    chimePolicies.set(key, {
      until: data.until,
      silent: data.mode !== "fallback",
    });
  }
});

function pushIsSilent() {
  const now = Date.now();
  for (const [key, policy] of chimePolicies)
    if (policy.until <= now) chimePolicies.delete(key);
  return [...chimePolicies.values()].some((policy) => policy.silent);
}

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let message;
      try {
        message = event.data?.json();
      } catch {
        /* Show a visible fallback for invalid payloads. */
      }
      const target = message?.target;
      const valid = validNotificationTarget(target);
      await self.registration.showNotification(
        typeof message?.title === "string"
          ? message.title
          : "Herdr World agent update",
        {
          body:
            typeof message?.body === "string"
              ? message.body
              : "Open Herdr World to check your agents.",
          tag:
            typeof message?.tag === "string" ? message.tag : "herdr-world-task",
          silent: pushIsSilent(),
          data: {
            type: "herdr-world:task-notification-activate",
            target: valid ? target : null,
          },
        },
      );
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data;
  if (data?.type !== "herdr-world:task-notification-activate") return;
  // Pane-less notifications (e.g. observer alerts) only focus or open the app.
  const target = data.target ?? null;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const appWindows = windows.filter((client) => {
        const url = new URL(client.url);
        return (
          url.origin === self.location.origin &&
          (url.pathname === "/" || url.pathname === "/index.html")
        );
      });
      appWindows.sort((a, b) => Number(b.focused) - Number(a.focused));
      for (const client of appWindows) {
        try {
          await client.focus().catch(() => {});
          if (target) client.postMessage(data);
          return;
        } catch {
          // A window can close between discovery and activation.
        }
      }
      const url = new URL("/", self.location.origin);
      if (target)
        url.hash =
          "herdr-world-task=" + encodeURIComponent(JSON.stringify(target));
      await self.clients.openWindow(url.href);
    })(),
  );
});
