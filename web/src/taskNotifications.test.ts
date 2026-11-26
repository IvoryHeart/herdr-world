import { describe, expect, jest, mock, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import {
  listenForTaskNotificationActivation,
  prepareTaskNotifications,
  showTaskNotification,
  TASK_NOTIFICATION_ACTIVATE_EVENT,
  taskNotificationView,
} from "./taskNotifications";
import { __storeTesting, emptyServerSessionState, store } from "./store";
import { bridge, type ConnectionClient } from "./api";
import { notifyWorldAsk } from "./store/notifications";
import { handlePreferenceStorageChange } from "./store/updates";
import { worldLocalStorage } from "./browserStorage";
import { resetFocusForTests } from "./world/focus";
import {
  TASK_NOTIFICATIONS_KEY,
  TASK_NOTIFICATION_PREFERENCES_KEY,
} from "./store/notifications";

const origin = "https://herdr-world.example";
const target = {
  connectionId: "alpha",
  runtimeGeneration: 1,
  workspaceId: "w1",
  paneId: "p1",
};

test.each([
  "codex",
  "claude-code",
  "Pi-Coding-Agent",
  "antigravity cli",
  "kimi code",
  "grok build",
  "muse-code",
])(
  "notification Open agent follows the Chat/Terminal preference for %s",
  (agent) => {
    expect(taskNotificationView({ agent }, "chat")).toBe("history");
    expect(taskNotificationView({ agent }, "terminal")).toBe("terminal");
  },
);
test.each([undefined, "", " ", "gemini", "unknown-harness"])(
  "notification Open agent falls back to Terminal for %s",
  (agent) => {
    expect(taskNotificationView({ agent }, "chat")).toBe("terminal");
  },
);

async function withBrowser(
  overrides: Record<string, unknown>,
  run: () => Promise<void>,
) {
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const previousState = store.get();
  const defaults = {
    window: { location: new URL(origin), Notification: {} },
    navigator: {},
    localStorage: { setItem() {} },
    Notification: class {
      static permission = "granted";
      constructor() {
        throw new TypeError(
          "Use ServiceWorkerRegistration.showNotification instead.",
        );
      }
    },
  };
  for (const [key, value] of Object.entries({ ...defaults, ...overrides })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  try {
    await run();
  } finally {
    __storeTesting.replaceState(previousState);
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

function registration() {
  return {
    active: {
      scriptURL: origin + "/task-notifications-sw.js?v=4",
      state: "activated",
    },
    showNotification: mock(async () => {}),
  };
}

describe("background notification restore", () => {
  async function restoring(
    run: (f: {
      document: EventTarget & { visibilityState: string };
      window: EventTarget;
      getRegistration: ReturnType<typeof mock>;
      getSubscription: ReturnType<typeof mock>;
      fetch: ReturnType<typeof mock>;
      resume: (target: EventTarget, event: string) => Promise<void>;
    }) => Promise<void>,
  ) {
    const document = Object.assign(new EventTarget(), {
      visibilityState: "visible",
    });
    const window = Object.assign(new EventTarget(), {
      location: new URL(origin),
      PushManager: {},
    });
    const getSubscription = mock(async () => null);
    const getRegistration = mock(async () => ({
      ...registration(),
      pushManager: { getSubscription },
    }));
    const fetch = mock(async () => Response.json({ available: false }));
    const stored = new Map<string, string>();
    await withBrowser(
      {
        document,
        window,
        fetch,
        navigator: { serviceWorker: { getRegistration } },
        localStorage: {
          getItem: (key: string) => stored.get(key) ?? null,
          setItem: (key: string, value: string) => stored.set(key, value),
        },
      },
      async () => {
        __storeTesting.replaceState({
          ...store.get(),
          taskNotificationsEnabled: true,
          taskNotificationBusy: false,
          notice: null,
        });
        try {
          await run({
            document,
            window,
            getRegistration,
            getSubscription,
            fetch,
            async resume(target, event) {
              const done = Promise.withResolvers<void>();
              const unsubscribe = store.subscribe(() => {
                if (!store.get().taskNotificationBusy) done.resolve();
              });
              try {
                target.dispatchEvent(new Event(event));
                await done.promise;
              } finally {
                unsubscribe();
              }
            },
          });
        } finally {
          // Drain any pending lifecycle retry before restoring the globals.
          document.visibilityState = "visible";
          await store.restoreTaskNotifications();
        }
      },
    );
  }

  test.each(["visibilitychange", "pageshow", "resume"])(
    "InvalidStateError stays quiet and retries once on visible %s",
    async (event) => {
      await restoring(async (f) => {
        f.getRegistration.mockRejectedValueOnce(
          new DOMException("Document is not active", "InvalidStateError"),
        );
        await store.restoreTaskNotifications();
        expect(store.get().notice).toBeNull();
        expect(store.get().taskNotificationBusy).toBe(false);
        expect(f.getRegistration).toHaveBeenCalledTimes(1);
        f.document.visibilityState = "hidden";
        f.document.dispatchEvent(new Event("visibilitychange"));
        f.window.dispatchEvent(new Event("pageshow"));
        f.document.dispatchEvent(new Event("resume"));
        expect(f.getRegistration).toHaveBeenCalledTimes(1);
        f.document.visibilityState = "visible";
        await f.resume(event === "pageshow" ? f.window : f.document, event);
        expect(store.get().notice).toBeNull();
        expect(f.getRegistration).toHaveBeenCalledTimes(2);
        f.document.dispatchEvent(new Event("visibilitychange"));
        f.window.dispatchEvent(new Event("pageshow"));
        f.document.dispatchEvent(new Event("resume"));
        expect(f.getRegistration).toHaveBeenCalledTimes(2);
      });
    },
  );

  test.each([
    new Error("Worker blocked"),
    new DOMException("Notification permission revoked", "NotAllowedError"),
  ])(
    "other errors still show the background sync notice: %s",
    async (error) => {
      await restoring(async (f) => {
        f.getRegistration.mockRejectedValueOnce(error);
        await store.restoreTaskNotifications();
        expect(store.get().notice).toMatchObject({
          kind: "error",
          message: "Background notification sync failed",
          detail: error.message,
        });
      });
    },
  );

  test("push API InvalidStateError defers revocation and retries on resume", async () => {
    await restoring(async (f) => {
      __storeTesting.replaceState({
        ...store.get(),
        taskNotificationsEnabled: false,
      });
      f.getSubscription.mockRejectedValueOnce(
        new DOMException("Document is not active", "InvalidStateError"),
      );
      await store.restoreTaskNotifications();
      expect(store.get().notice).toBeNull();
      expect(f.getSubscription).toHaveBeenCalledTimes(1);
      await f.resume(f.document, "resume");
      expect(f.getSubscription).toHaveBeenCalledTimes(2);
      expect(store.get().notice).toBeNull();
    });
  });

  test("passive restore still prepares local alerts without Web Push support", async () => {
    const getRegistration = mock(async () => registration());
    await withBrowser(
      { navigator: { serviceWorker: { getRegistration } } },
      async () => {
        __storeTesting.replaceState({
          ...store.get(),
          taskNotificationsEnabled: true,
          notice: null,
        });
        await store.restoreTaskNotifications();
        expect(getRegistration).toHaveBeenCalledTimes(1);
        expect(store.get().taskNotificationTransport).toBe("local");
        expect(store.get().notice).toBeNull();
      },
    );
  });

  test.each(["offline", "refused"])(
    "%s push sync still reports its failure",
    async (failure) => {
      await restoring(async (f) => {
        if (failure === "offline")
          f.fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
        else f.fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
        await store.restoreTaskNotifications();
        expect(store.get().notice).toMatchObject({
          kind: "error",
          message: "Background notification sync failed",
        });
        expect(store.get().taskNotificationBusy).toBe(false);
      });
    },
  );

  test.each([TASK_NOTIFICATIONS_KEY, TASK_NOTIFICATION_PREFERENCES_KEY, null])(
    "storage change %s coalesces restores until the tab is visible",
    async (key) => {
      await restoring(async (f) => {
        f.document.visibilityState = "hidden";
        handlePreferenceStorageChange(key);
        worldLocalStorage.setItem(TASK_NOTIFICATIONS_KEY, "true");
        worldLocalStorage.setItem(
          TASK_NOTIFICATION_PREFERENCES_KEY,
          JSON.stringify({ completed: false, blocked: true }),
        );
        handlePreferenceStorageChange(key);
        await store.restoreTaskNotifications();
        expect(f.getRegistration).not.toHaveBeenCalled();
        expect(store.get().notice).toBeNull();
        expect(store.get().taskNotificationsEnabled).toBe(true);
        expect(store.get().taskNotificationPreferences).toEqual({
          completed: false,
          blocked: true,
        });
        f.document.visibilityState = "visible";
        await f.resume(f.document, "visibilitychange");
        expect(f.getRegistration).toHaveBeenCalledTimes(1);
        expect(store.get().taskNotificationBusy).toBe(false);
        f.window.dispatchEvent(new Event("pageshow"));
        expect(f.getRegistration).toHaveBeenCalledTimes(1);
      });
    },
  );
});

describe("task notification transport", () => {
  test("a ledger ask raises its local OS notice even when Web Push is selected", async () => {
    const active = registration();
    await withBrowser(
      { navigator: { serviceWorker: { getRegistration: async () => active } } },
      async () => {
        __storeTesting.replaceState({
          ...store.get(),
          taskNotificationsEnabled: true,
          taskNotificationBusy: false,
          taskNotificationTransport: "push",
          taskNotificationPreferences: { completed: true, blocked: true },
          activeConnectionId: "alpha",
          connections: [
            {
              id: "beta",
              label: "Example",
              source: "test",
              is_default: false,
              state: "ready",
              generation: 2,
            },
          ],
        });
        notifyWorldAsk({
          id: "q-example",
          at: 1,
          question: "Which design?",
          options: [],
          owner_only: true,
          actor: {
            label: "Example",
            verified: true,
            connection_id: "beta",
            connection_generation: 2,
            workspace_id: "w1",
            pane_id: "w1:p1",
            terminal_id: "original-terminal",
            agent: "codex",
            agent_session_id: "original-session",
          },
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(active.showNotification).toHaveBeenCalledTimes(1);
        expect(active.showNotification).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            data: expect.objectContaining({
              target: expect.objectContaining({
                connectionId: "beta",
                runtimeGeneration: 2,
                terminalId: "original-terminal",
                agentSessionId: "original-session",
              }),
            }),
          }),
        );
      },
    );
  });

  test("a focus session that begins while the worker is prepared still holds the notice (#1131)", async () => {
    const active = registration();
    let ready: (value: unknown) => void = () => {};
    const getRegistration = () => new Promise((resolve) => (ready = resolve));
    await withBrowser(
      { navigator: { serviceWorker: { getRegistration } } },
      async () => {
        __storeTesting.replaceState({
          ...store.get(),
          taskNotificationsEnabled: true,
          taskNotificationBusy: false,
          taskNotificationTransport: "push",
          taskNotificationPreferences: { completed: true, blocked: true },
          activeConnectionId: "alpha",
          connections: [
            {
              id: "beta",
              label: "Example",
              source: "test",
              is_default: false,
              state: "ready",
              generation: 2,
            },
          ],
        });
        try {
          notifyWorldAsk({
            id: "q-focus",
            at: 1,
            question: "Which design?",
            options: [],
            owner_only: true,
            actor: {
              label: "Example",
              verified: true,
              connection_id: "beta",
              connection_generation: 2,
              workspace_id: "w1",
              pane_id: "w1:p1",
              terminal_id: "original-terminal",
              agent: "codex",
              agent_session_id: "original-session",
            },
          });
          const now = Date.now();
          resetFocusForTests({
            revision: 1,
            now,
            session: { id: "focus-a", started_at: now, ends_at: now + 60_000 },
            last: null,
          });
          ready(active);
          await new Promise((resolve) => setTimeout(resolve, 0));
          expect(active.showNotification).not.toHaveBeenCalled();
        } finally {
          resetFocusForTests();
        }
      },
    );
  });

  test("uses an active worker when the mobile page constructor throws", async () => {
    const active = registration();
    const register = mock();
    await withBrowser(
      {
        navigator: {
          serviceWorker: { getRegistration: async () => active, register },
        },
      },
      async () => {
        await showTaskNotification(
          "Completed",
          { body: "Agent", tag: "task" },
          target,
          () => true,
        );
        expect(register).not.toHaveBeenCalled();
        expect(active.showNotification).toHaveBeenCalledWith("Completed", {
          body: "Agent",
          tag: "task",
          data: { type: TASK_NOTIFICATION_ACTIVATE_EVENT, target },
        });
      },
    );
  });

  test("registers and waits for activation, then drops a canceled delivery", async () => {
    const active = registration();
    const pending = { ...active, active: null as typeof active.active | null };
    const ready = Promise.withResolvers<void>();
    const register = mock(async () => pending);
    const serviceWorker = {
      getRegistration: async () => undefined,
      register,
      ready: ready.promise,
    };
    await withBrowser({ navigator: { serviceWorker } }, async () => {
      const showing = showTaskNotification(
        "Completed",
        {},
        target,
        () => false,
      );
      await Promise.resolve();
      await Promise.resolve();
      expect(active.showNotification).not.toHaveBeenCalled();
      expect(register).toHaveBeenCalledWith("/task-notifications-sw.js?v=4", {
        updateViaCache: "none",
      });
      pending.active = active.active;
      ready.resolve();
      await showing;
      expect(active.showNotification).not.toHaveBeenCalled();
    });
  });

  test("keeps the page notification fallback and its click handler", async () => {
    const notification = { close() {}, onclick: null };
    const Notification = mock(function () {
      return notification;
    });
    await withBrowser({ Notification }, async () => {
      await showTaskNotification(
        "Completed",
        { body: "Agent", tag: "task" },
        target,
        () => true,
      );
      expect(Notification).toHaveBeenCalledWith("Completed", {
        body: "Agent",
        tag: "task",
      });
      expect(typeof notification.onclick).toBe("function");
    });
  });

  test("bounds unavailable worker activation and reports registration errors", async () => {
    jest.useFakeTimers();
    try {
      await withBrowser(
        {
          navigator: {
            serviceWorker: { getRegistration: () => new Promise(() => {}) },
          },
        },
        async () => {
          const preparing = prepareTaskNotifications().catch((error) => error);
          jest.advanceTimersByTime(10_000);
          expect((await preparing).message).toContain("did not become ready");
        },
      );
    } finally {
      jest.useRealTimers();
    }
    await withBrowser(
      {
        navigator: {
          serviceWorker: {
            getRegistration: async () => {
              throw new Error("Worker blocked");
            },
          },
        },
      },
      async () => {
        await expect(prepareTaskNotifications()).rejects.toThrow(
          "Worker blocked",
        );
      },
    );
  });

  test("does not hide showNotification rejection", async () => {
    const active = {
      ...registration(),
      showNotification: async () => {
        throw new Error("Delivery denied");
      },
    };
    await withBrowser(
      { navigator: { serviceWorker: { getRegistration: async () => active } } },
      async () => {
        await expect(
          showTaskNotification("Completed", {}, target, () => true),
        ).rejects.toThrow("Delivery denied");
      },
    );
  });

  test("keeps a failed transport disabled and explains the failure", async () => {
    await withBrowser(
      {
        navigator: {
          serviceWorker: {
            getRegistration: async () => {
              throw new Error("Worker blocked");
            },
          },
        },
      },
      async () => {
        await store.setTaskNotificationsEnabled(true);
        expect(store.get().taskNotificationsEnabled).toBe(false);
        expect(store.get().notice).toMatchObject({
          kind: "error",
          message: "Task notifications are unavailable",
          detail: "Worker blocked",
        });
      },
    );
  });

  test.each([
    ["done", "local", true, true],
    ["blocked", "local", true, true],
    ["done", "push", true, false],
    ["blocked", "push", true, false],
    ["done", "local", false, false],
    ["blocked", "local", false, false],
  ] as const)(
    "task %s via %s respects preference %s and reports local failure %s",
    async (status, transport, enabled, fails) => {
      const active = {
        ...registration(),
        showNotification: async () => {
          throw new Error("Delivery denied");
        },
      };
      await withBrowser(
        {
          navigator: { serviceWorker: { getRegistration: async () => active } },
        },
        async () => {
          const previousConnection = bridge.connection;
          const pane = {
            pane_id: "p1",
            workspace_id: "w1",
            terminal_id: "t1",
            tab_id: "tab1",
            focused: false,
            agent: "Agent",
            agent_status: "working",
            revision: 1,
          };
          bridge.connection = (() =>
            ({
              connectionId: "alpha",
              generation: 10,
              isCurrent: () => true,
              call: async (method: string) =>
                method === "pane.list" ? { panes: [{ ...pane }] } : {},
            }) as ConnectionClient) as typeof bridge.connection;
          __storeTesting.replaceState({
            ...store.get(),
            ...emptyServerSessionState(1),
            status: "connected",
            connectionPaused: false,
            activeConnectionId: "alpha",
            connectionGeneration: 10,
            connections: [
              {
                id: "alpha",
                label: "Alpha",
                source: "test",
                is_default: true,
                state: "ready",
                generation: 1,
              },
            ],
            taskNotificationsEnabled: true,
            taskNotificationTransport: transport,
            taskNotificationPreferences: {
              completed: status === "done" ? enabled : true,
              blocked: status === "blocked" ? enabled : true,
            },
            taskNotificationPermission: "granted",
          });
          const failed = Promise.withResolvers<void>();
          const unsubscribe = store.subscribe(() => {
            if (
              store.get().notice?.message ===
              "Task notifications are unavailable"
            )
              failed.resolve();
          });
          try {
            await store.refresh();
            pane.agent_status = status;
            await store.refresh();
            if (fails) {
              await failed.promise;
              expect(store.get().taskNotificationsEnabled).toBe(false);
              expect(store.get().notice).toMatchObject({
                kind: "error",
                detail: "Delivery denied",
              });
            } else {
              for (let index = 0; index < 10; index++) await Promise.resolve();
              expect(store.get().taskNotificationsEnabled).toBe(true);
              expect(store.get().notice?.kind).not.toBe("error");
            }
          } finally {
            unsubscribe();
            bridge.connection = previousConnection;
          }
        },
      );
    },
  );

  test("requests permission in the gesture and cannot re-enable after a later disable", async () => {
    const permission = Promise.withResolvers<NotificationPermission>();
    const requestPermission = mock(() => permission.promise);
    await withBrowser(
      { Notification: { permission: "default", requestPermission } },
      async () => {
        const enabling = store.setTaskNotificationsEnabled(true);
        expect(requestPermission).toHaveBeenCalledTimes(1);
        await store.setTaskNotificationsEnabled(false);
        permission.resolve("granted");
        await enabling;
        expect(store.get().taskNotificationsEnabled).toBe(false);
      },
    );
  });

  test("validates worker messages, consumes launch fragments and removes listeners", async () => {
    const serviceWorker = new EventTarget();
    const activate = mock();
    const replaceState = mock();
    const location = new URL(
      origin +
        "/#herdr-world-task=" +
        encodeURIComponent(JSON.stringify(target)),
    );
    await withBrowser(
      {
        navigator: { serviceWorker },
        window: { location, history: { replaceState, state: { scroll: 10 } } },
      },
      async () => {
        const stop = listenForTaskNotificationActivation(activate);
        expect(activate).toHaveBeenCalledWith(target);
        expect(replaceState).toHaveBeenCalledWith({ scroll: 10 }, "", "/");
        activate.mockClear();
        const message = (messageOrigin: string, value: unknown) =>
          new MessageEvent("message", {
            origin: messageOrigin,
            data: { type: TASK_NOTIFICATION_ACTIVATE_EVENT, target: value },
          });
        serviceWorker.dispatchEvent(message("https://other.example", target));
        serviceWorker.dispatchEvent(
          message(origin, { ...target, runtimeGeneration: -1 }),
        );
        expect(activate).not.toHaveBeenCalled();
        serviceWorker.dispatchEvent(message(origin, target));
        expect(activate).toHaveBeenCalledTimes(1);
        stop();
        serviceWorker.dispatchEvent(message(origin, target));
        expect(activate).toHaveBeenCalledTimes(1);
      },
    );
  });
});

describe("notification service worker clicks", () => {
  test("push displays a visible notification with no open page, including malformed payloads", async () => {
    const listeners: Record<string, (event: any) => void> = {};
    const showNotification = mock(async () => {});
    runInNewContext(
      await readFile(
        new URL("../public/task-notifications-sw.js", import.meta.url),
        "utf8",
      ),
      {
        URL,
        self: {
          addEventListener: (name: string, handler: (event: any) => void) => {
            listeners[name] = handler;
          },
          registration: { showNotification },
        },
      },
    );
    let pending: Promise<void> | undefined;
    const message = {
      title: "Herdr World agent needs input",
      body: "Example agent",
      tag: "task",
      target,
    };
    listeners.push({
      data: { json: () => message },
      waitUntil: (value: Promise<void>) => {
        pending = value;
      },
    });
    await pending;
    expect(showNotification).toHaveBeenCalledWith(message.title, {
      body: message.body,
      tag: message.tag,
      silent: false,
      data: { type: TASK_NOTIFICATION_ACTIVATE_EVENT, target },
    });
    // While a page plays World's chimes, push stays silent; a claim far in
    // the future is ignored.
    const pushAgain = async () => {
      listeners.push({
        data: { json: () => message },
        waitUntil: (value: Promise<void>) => {
          pending = value;
        },
      });
      await pending;
      return (showNotification.mock.calls.slice(-1)[0] as unknown[])[1];
    };
    listeners.message({
      data: { type: "herdr-world:chimes-active", until: Date.now() + 600_000 },
    });
    expect(await pushAgain()).toMatchObject({ silent: false });
    listeners.message({
      data: { type: "herdr-world:chimes-active", until: Date.now() + 30_000 },
    });
    expect(await pushAgain()).toMatchObject({ silent: true });
    listeners.message({
      source: { id: "another-page" },
      data: {
        type: "herdr-world:chime-policy",
        mode: "fallback",
        until: Date.now() + 30_000,
      },
    });
    expect(await pushAgain()).toMatchObject({ silent: true });
    listeners.message({
      data: { type: "herdr-world:chimes-active", until: Date.now() - 1 },
    });
    expect(await pushAgain()).toMatchObject({ silent: false });
    listeners.push({
      data: {
        json: () => {
          throw new Error("Invalid JSON");
        },
      },
      waitUntil: (value: Promise<void>) => {
        pending = value;
      },
    });
    await pending;
    // Malformed and pane-less payloads still open the app on click.
    expect(showNotification.mock.calls.slice(-1)[0]).toMatchObject([
      "Herdr World agent update",
      { data: { type: TASK_NOTIFICATION_ACTIVATE_EVENT, target: null } },
    ]);
    listeners.push({
      data: {
        json: () => ({
          title: "codex needs input",
          body: "idle",
          target: null,
        }),
      },
      waitUntil: (value: Promise<void>) => {
        pending = value;
      },
    });
    await pending;
    expect(showNotification).toHaveBeenLastCalledWith("codex needs input", {
      body: "idle",
      tag: "herdr-world-task",
      silent: false,
      data: { type: TASK_NOTIFICATION_ACTIVATE_EVENT, target: null },
    });
  });
  test("focuses an app window or opens a same-origin pane link without caching", async () => {
    const listeners: Record<string, (event: any) => void> = {};
    const postMessage = mock();
    const focus = mock(async () => {
      throw new Error("Focus denied");
    });
    let windows: any[] = [
      { url: origin + "/login", focus: mock() },
      { url: origin + "/", focus, postMessage },
    ];
    const openWindow = mock(async () => {});
    runInNewContext(
      await readFile(
        new URL("../public/task-notifications-sw.js", import.meta.url),
        "utf8",
      ),
      {
        URL,
        self: {
          location: { origin },
          addEventListener: (name: string, handler: (event: any) => void) => {
            listeners[name] = handler;
          },
          clients: { matchAll: async () => windows, openWindow },
        },
      },
    );
    expect(Object.keys(listeners).sort()).toEqual([
      "activate",
      "install",
      "message",
      "notificationclick",
      "push",
    ]);
    const close = mock();
    let pending: Promise<void> | undefined;
    const event = {
      notification: {
        close,
        data: { type: TASK_NOTIFICATION_ACTIVATE_EVENT, target },
      },
      waitUntil: (promise: Promise<void>) => {
        pending = promise;
      },
    };
    listeners.notificationclick(event);
    await pending;
    expect(close).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(event.notification.data);
    expect(openWindow).not.toHaveBeenCalled();
    windows = [{ url: "https://other.example/", focus: mock() }];
    listeners.notificationclick(event);
    await pending;
    expect(openWindow).toHaveBeenCalledWith(
      origin +
        "/#herdr-world-task=" +
        encodeURIComponent(JSON.stringify(target)),
    );
  });
  test("pane-less clicks focus the app without navigating", async () => {
    const listeners: Record<string, (event: any) => void> = {};
    const postMessage = mock();
    const focus = mock(async () => {});
    let windows: any[] = [{ url: origin + "/", focus, postMessage }];
    const openWindow = mock(async () => {});
    runInNewContext(
      await readFile(
        new URL("../public/task-notifications-sw.js", import.meta.url),
        "utf8",
      ),
      {
        URL,
        self: {
          location: { origin },
          addEventListener: (name: string, handler: (event: any) => void) => {
            listeners[name] = handler;
          },
          clients: { matchAll: async () => windows, openWindow },
        },
      },
    );
    let pending: Promise<void> | undefined;
    const event = {
      notification: {
        close: mock(),
        data: { type: TASK_NOTIFICATION_ACTIVATE_EVENT, target: null },
      },
      waitUntil: (promise: Promise<void>) => {
        pending = promise;
      },
    };
    listeners.notificationclick(event);
    await pending;
    expect(focus).toHaveBeenCalledTimes(1);
    expect(postMessage).not.toHaveBeenCalled();
    windows = [];
    listeners.notificationclick(event);
    await pending;
    expect(openWindow).toHaveBeenCalledWith(origin + "/");
  });
});
