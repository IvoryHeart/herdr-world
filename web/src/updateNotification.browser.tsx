import { createUpdateNotificationHistory } from "./updateNotifications";
import { worldLocalStorage } from "./browserStorage";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import App from "./App";
import { bridge, type ConnectionClient } from "./api";
import { __storeTesting, store } from "./store";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/vendor.css";

const failures: string[] = [];
const check = (value: unknown, message: string) => {
  if (!value) failures.push(message);
};
const frame = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
async function until(predicate: () => unknown) {
  for (let i = 0; i < 120; i++) {
    if (predicate()) return;
    await frame();
  }
  throw new Error(
    `Update fixture did not reach ${predicate.name || predicate.toString()}: ${document.body.innerText.slice(0, 500)}`,
  );
}
const nativeFetch = window.fetch.bind(window);
let latest = "1.2.3";
let available = true;
let installFails = true;
let installs = 0;
let canAutoUpdate = true;
window.fetch = (async (url: string, init?: RequestInit) => {
  if (url === "/api/update/check")
    return Response.json({
      current_version: "1.0.0",
      latest_version: latest,
      update_available: available,
      can_auto_update: canAutoUpdate,
      platform: "linux-x64",
      reason: canAutoUpdate
        ? undefined
        : "Use the installation channel to upgrade",
    });
  if (url === "/api/update/install") {
    installs++;
    check(
      init?.method === "POST" &&
        new Headers(init.headers).get("x-herdr-world-update") === "1",
      "Upgrade lost explicit request guard",
    );
    return Response.json(
      installFails
        ? { error: "Synthetic failure" }
        : { installed: true, installed_version: latest },
      { status: installFails ? 500 : 200 },
    );
  }
  return Response.json({
    version: "1.0.0",
    protocol: 22,
    auth_required: false,
  });
}) as typeof fetch;
const client: ConnectionClient = {
  connectionId: "update-fixture",
  generation: 1,
  serverRuntimeGeneration: 1,
  isCurrent: () => true,
  acceptsServerGeneration: (generation) => generation === 1,
  call: async () => ({}),
};
store.init = () => {};
bridge.connection = () => client;
bridge.onTerminal = () => () => {};
bridge.onTerminalClosed = () => () => {};
bridge.onEvent = () => () => {};
__storeTesting.replaceState({
  ...store.get(),
  status: "connected",
  activeConnectionId: client.connectionId,
  defaultConnectionId: client.connectionId,
  connectionGeneration: 1,
  serverRuntimeGeneration: 1,
  catalogueReady: true,
  updateInfo: null,
  dismissedUpdateVersion: null,
  notice: null,
  workspaces: [],
  tabs: [],
  panes: [],
});
const root = createRoot(
  document.getElementById("root") ??
    document.body.appendChild(document.createElement("div")),
);
const menu = () => document.querySelector<HTMLButtonElement>(".menu-button");
const toast = () =>
  document.querySelector('[aria-label="Dismiss update notification"]');
const manualCheck = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) =>
      button.querySelector("strong")?.textContent === "Check for updates",
  );
async function settleMenu() {
  await Promise.all(
    document
      .querySelector(".config-dropdown")!
      .getAnimations({ subtree: true })
      .map((animation) => animation.finished.catch(() => {})),
  );
  await frame();
}
const upgrade = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.includes(`Upgrade to ${latest}`),
  );
async function checkIndependentContexts() {
  const contexts = [
    document.createElement("iframe"),
    document.createElement("iframe"),
  ];
  const ready = new Set<MessageEventSource>();
  const results = new Map<MessageEventSource, boolean>();
  const receive = (event: MessageEvent) => {
    if (
      event.origin !== location.origin ||
      !event.source ||
      !contexts.some((context) => context.contentWindow === event.source)
    )
      return;
    if (event.data?.type === "update-claim-ready") {
      ready.add(event.source);
      if (ready.size === contexts.length)
        for (const context of contexts)
          context.contentWindow!.postMessage(
            { type: "update-claim-start" },
            location.origin,
          );
    }
    if (
      event.data?.type === "update-claim-result" &&
      typeof event.data.won === "boolean"
    )
      results.set(event.source, event.data.won);
  };
  addEventListener("message", receive);
  try {
    for (const context of contexts) {
      context.hidden = true;
      context.src = `${location.origin}/?claim=9.0.1-context-race`;
      document.body.append(context);
    }
    await until(() => results.size === contexts.length);
    check(
      [...results.values()].filter(Boolean).length === 1,
      "Independent browsing contexts did not produce exactly one notification winner",
    );
  } finally {
    removeEventListener("message", receive);
    for (const context of contexts) context.remove();
  }
}

async function run() {
  // Reproduce a permitted read/write interleaving with actual origin storage.
  const second = createUpdateNotificationHistory(worldLocalStorage);
  let secondClaim: boolean | Promise<boolean> | undefined;
  const first = createUpdateNotificationHistory({
    getItem(key) {
      const snapshot = worldLocalStorage.getItem(key);
      if (secondClaim === undefined) secondClaim = second.claim("9.0.0-race");
      return snapshot;
    },
    setItem: (key, value) => worldLocalStorage.setItem(key, value),
  });
  const firstClaim = await first.claim("9.0.0-race");
  check(
    Number(firstClaim) + Number(await secondClaim) === 1,
    "Concurrent notification claim has more than one winner",
  );
  await checkIndependentContexts();
  flushSync(() => root.render(<App />));
  await until(menu);
  await store.checkForUpdate();
  await until(toast);
  check(
    document.querySelector(".menu-update-dot"),
    "Available update has no menu dot",
  );
  (toast() as HTMLButtonElement).click();
  await until(() => !toast());
  await store.checkForUpdate();
  await frame();
  check(!toast(), "Manual check repeated the notification");
  check(
    store.get().notice?.message === "Update check complete",
    "Suppressed manual check has no completion feedback",
  );
  store.clearNotice();
  check(
    menu()?.getAttribute("aria-label") === "Menu, update available",
    "Dismissal removed accessible update attention",
  );
  // Reload-like state loss while automatic checking is disabled: use the actual
  // menu action, not a direct store call, to rediscover a suppressed release.
  store.setAutomaticUpdateChecksEnabled(false);
  __storeTesting.replaceState({
    ...store.get(),
    updateInfo: null,
    dismissedUpdateVersion: null,
  });
  await until(() => menu()?.getAttribute("aria-label") === "Menu");
  menu()!.click();
  await until(manualCheck);
  manualCheck()!.click();
  await until(() => store.get().notice?.message === "Update check complete");
  check(
    !toast() && store.get().notice?.detail?.includes(latest),
    "Manual menu recheck did not answer without a repeated release toast",
  );
  store.clearNotice();
  menu()!.click();
  await until(upgrade);
  upgrade()!.scrollIntoView({ block: "nearest" });
  await settleMenu();
  const rect = upgrade()!.getBoundingClientRect();
  check(
    rect.width > 0 &&
      rect.left >= 0 &&
      rect.right <= innerWidth &&
      rect.top >= 0 &&
      rect.bottom <= innerHeight,
    "Upgrade action is outside the viewport",
  );
  await nativeFetch("/capture/update-notification", { method: "POST" });
  upgrade()!.click();
  await until(() => store.get().notice?.message === "Update install failed");
  check(
    installs === 1 && store.get().updateInfo?.update_available,
    "Failed upgrade lost retry offer",
  );
  menu()!.click();
  await until(upgrade);
  installFails = false;
  upgrade()!.click();
  await until(() => !document.querySelector(".menu-update-dot"));
  check(installs === 2, "Retry did not use existing installer action");
  latest = "1.2.4";
  await store.checkForUpdate();
  await until(toast);
  (toast() as HTMLButtonElement).click();
  await until(() => !toast());
  latest = "1.2.5";
  canAutoUpdate = false;
  await store.checkForUpdate();
  await until(toast);
  (toast() as HTMLButtonElement).click();
  await until(() => !toast());
  menu()!.click();
  await until(upgrade);
  check(upgrade()!.disabled, "Unsupported installation enabled Upgrade");
  check(
    document.body.textContent?.includes(
      "Use the installation channel to upgrade",
    ),
    "Blocked upgrade lost its channel reason",
  );
  check(installs === 2, "Unsupported installation invoked installer");
  store.clearNotice();
  store.setAutomaticUpdateChecksEnabled(false);
  const reason = document.querySelector<HTMLElement>(".config-update-reason");
  check(
    reason &&
      reason.getClientRects().length > 0 &&
      getComputedStyle(reason).display !== "none" &&
      getComputedStyle(reason).visibility !== "hidden",
    "Blocked channel reason is not visibly rendered",
  );
  const recheck = manualCheck();
  check(recheck && !recheck.disabled, "Blocked channel has no manual recheck");
  reason?.scrollIntoView({ block: "nearest" });
  await settleMenu();
  await nativeFetch("/capture/update-notification?state=blocked", {
    method: "POST",
  });
  available = false;
  if (recheck) recheck.click();
  else await store.checkForUpdate();
  await until(() => !document.querySelector(".menu-update-dot"));
  check(!upgrade(), "Current installation still offers upgrade");
}
const childVersion = new URL(location.href).searchParams.get("claim");
if (childVersion) {
  const start = async (event: MessageEvent) => {
    if (
      event.origin !== location.origin ||
      event.source !== parent ||
      event.data?.type !== "update-claim-start"
    )
      return;
    removeEventListener("message", start);
    const won =
      await createUpdateNotificationHistory(worldLocalStorage).claim(
        childVersion,
      );
    parent.postMessage({ type: "update-claim-result", won }, location.origin);
  };
  addEventListener("message", start);
  parent.postMessage({ type: "update-claim-ready" }, location.origin);
} else {
  run()
    .catch((error) => failures.push(String(error)))
    .finally(async () => {
      root.unmount();
      await nativeFetch("/result", {
        method: "POST",
        body: JSON.stringify(failures),
      });
    });
}
