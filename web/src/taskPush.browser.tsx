import { clock } from "./testing/installRunningTestClock";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { ConfigMenu } from "./components/ConfigMenu";
import { __storeTesting, store } from "./store";
import "./styles/tokens.css";
import "./styles/base.css";

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const advanceTime = () => clock.advance(50);
const originalFetch = window.fetch;
const calls: Array<{ method: string; body: any }> = [];
let subscribed = true;
const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/example-device",
  options: {},
  toJSON() {
    return {
      endpoint: this.endpoint,
      keys: { p256dh: "fixture", auth: "fixture" },
    };
  },
  async unsubscribe() {
    subscribed = false;
    return true;
  },
};
const mockFetch = async (input: RequestInfo | URL, options?: RequestInit) => {
  if (String(input).includes("/api/notifications/push")) {
    calls.push({
      method: options?.method ?? "GET",
      body: options?.body ? JSON.parse(String(options.body)) : null,
    });
    return Response.json({
      available: true,
      publicKey: btoa(String.fromCharCode(4, ...Array(64).fill(1))),
    });
  }
  return Response.json({});
};
Object.defineProperty(window, "fetch", {
  configurable: true,
  value: mockFetch,
});
Object.defineProperty(window, "Notification", {
  configurable: true,
  value: { permission: "granted" },
});
Object.defineProperty(window, "PushManager", { configurable: true, value: {} });
Object.defineProperty(navigator, "serviceWorker", {
  configurable: true,
  value: {
    getRegistration: async () => ({
      active: {
        state: "activated",
        scriptURL: location.origin + "/task-notifications-sw.js?v=4",
      },
      showNotification() {
        failures.push("push mode invoked local delivery");
      },
      pushManager: {
        getSubscription: async () => (subscribed ? subscription : null),
      },
    }),
  },
});

async function run() {
  document.documentElement.dataset.layout =
    innerWidth < 600 ? "mobile" : "desktop";
  __storeTesting.replaceState({
    ...store.get(),
    taskNotificationsEnabled: true,
    taskNotificationPermission: "granted",
    taskNotificationTransport: "push",
    taskNotificationPreferences: { completed: true, blocked: true },
  });
  const container = document.createElement("div");
  container.style.cssText =
    "display:flex;justify-content:flex-end;padding:12px";
  document.body.append(container);
  const root = createRoot(container);
  for (const theme of ["light", "dark"] as const) {
    document.documentElement.dataset.theme = theme;
    flushSync(() =>
      root.render(
        <ConfigMenu
          onShowShortcuts={() => {}}
          theme={theme}
          accentColor="blue"
          blackBackground={false}
          onBlackBackgroundChange={() => {}}
          uiScale={100}
          terminalFontName=""
          onTerminalFontNameChange={() => {}}
          terminalFontScale={100}
          onTerminalFontScaleChange={() => {}}
          zenMode={false}
          mobileTerminalShortcuts={[[], []]}
          mobileTerminalSideShortcuts={[]}
          terminalThemeSelection={{ dark: "default", light: "default" }}
          customTerminalThemes={[]}
          onThemeChange={() => {}}
          onAccentColorChange={() => {}}
          onUiScaleChange={() => {}}
          onZenModeChange={() => {}}
          onMobileTerminalShortcutsChange={() => {}}
          onMobileTerminalSideShortcutsChange={() => {}}
          onTerminalThemeSelectionChange={() => {}}
          onCustomTerminalThemesChange={() => {}}
        />,
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      "button[aria-label='Menu']",
    )!;
    if (!document.querySelector(".settings-home")) {
      flushSync(() => trigger.click());
      const settings = Array.from(
        document.querySelectorAll<HTMLButtonElement>(".config-menu-item"),
      ).find((button) => button.textContent?.includes("Settings"))!;
      flushSync(() => settings.click());
      // Settings loads as its own chunk: wait for that real fetch itself, so
      // test time does not run out before it lands.
      await import("./settings/SettingsHome");
      await clock.until(
        () => Boolean(document.querySelector(".settings-home")),
        "Settings did not open",
      );
    }
    const menu = document.querySelector<HTMLElement>(".settings-home")!;
    flushSync(() =>
      menu
        .querySelector<HTMLButtonElement>("#settings-tab-notifications")!
        .click(),
    );
    await advanceTime();
    check(Boolean(menu), `${theme}: notification configuration missing`);
    for (const animation of menu.getAnimations({ subtree: true }))
      animation.finish();
    const master = menu.querySelector<HTMLButtonElement>(
      "button[aria-label='Task notifications']",
    )!;
    const status = master
      .closest(".settings-home-row")!
      .querySelector<HTMLElement>(".config-item-copy > span")!;
    check(
      status.textContent?.includes("Background push") === true &&
        getComputedStyle(status).display !== "none" &&
        status.clientWidth > 0,
      `${theme}: delivery mode not visible`,
    );
    const completion = menu.querySelector<HTMLButtonElement>(
      "button[aria-label='Notify when a task finishes']",
    )!;
    const blocked = menu.querySelector<HTMLButtonElement>(
      "button[aria-label='Notify when a task needs you']",
    )!;
    completion.scrollIntoView({ block: "nearest" });
    completion.focus();
    flushSync(() => completion.click());
    await advanceTime();
    check(
      completion.getAttribute("aria-checked") === "false",
      `${theme}: completion preference not updated`,
    );
    check(
      blocked.getAttribute("aria-checked") === "true",
      `${theme}: blocked preference changed with completion`,
    );
    check(
      document.activeElement === completion,
      `${theme}: saving lost keyboard focus`,
    );
    check(
      calls.slice(-1)[0]?.body.preferences.completed === false,
      `${theme}: device preference not sent`,
    );
    for (const control of [completion, blocked]) {
      control.scrollIntoView({ block: "nearest" });
      const rect = control.getBoundingClientRect();
      const label = control
        .closest(".settings-home-row")!
        .querySelector<HTMLElement>(".config-item-copy strong")!;
      check(
        label.clientWidth > 0 && label.scrollWidth <= label.clientWidth,
        `${theme}: ${control.getAttribute("aria-label")} label is truncated`,
      );
      check(
        Math.abs(rect.right - master.getBoundingClientRect().right) < 1,
        `${theme}: child switch is not right-aligned with master`,
      );
      check(
        rect.left >= 0 &&
          rect.right <= innerWidth &&
          rect.top >= 0 &&
          rect.bottom <= innerHeight,
        `${theme}: switch is inaccessible at width ${innerWidth}`,
      );
    }
    flushSync(() => completion.click());
    await advanceTime();
  }
  const toggle = document.querySelector<HTMLButtonElement>(
    "button[aria-label='Task notifications']",
  )!;
  flushSync(() => toggle.click());
  await advanceTime();
  check(
    calls.slice(-1)[0]?.method === "DELETE" && !subscribed,
    "device was not revoked",
  );
  check(
    toggle.getAttribute("aria-checked") === "false",
    "master switch remained enabled",
  );
  check(
    !document.querySelector(
      "button[aria-label='Notify when a task needs you']",
    ),
    "disabled preferences remained visible",
  );
  root.unmount();
}
void run()
  .catch((error) => failures.push(error.stack ?? String(error)))
  .finally(() =>
    originalFetch("/result", {
      method: "POST",
      body: JSON.stringify(failures),
    }),
  );
