import { createUpdateNotificationHistory } from "./updateNotifications";
import { worldLocalStorage } from "./browserStorage";
import { type ComponentType, Suspense, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import App from "./App";
import { AppToasts } from "./components/AppToasts";
import { StaleBuildToast } from "./components/StaleBuildToast";
import { UpdateToast } from "./components/UpdateToast";
import { NeedsYouMessage } from "./world/NeedsYouItem";
import "./world/world.css";
import { bridge, type ConnectionClient } from "./api";
import { lazyWithReload } from "./lazyWithReload";
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
let servedEntry: string | null = null;
let buildChecks = 0;
window.fetch = (async (url: string, init?: RequestInit) => {
  if (url.startsWith("/index.html?")) buildChecks++;
  if (servedEntry && url.startsWith("/index.html?"))
    return new Response(
      `<script type="module" crossorigin src="${servedEntry}"></script>`,
      { headers: { "content-type": "text/html" } },
    );
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

async function checkDismissPointerIsolation() {
  let dismissals = 0;
  const events: string[] = [];
  const trace = (event: Event) => {
    const target = event.target as Element;
    events.push(
      `${event.type}:${target.closest("button")?.getAttribute("aria-label") ?? target.tagName}`,
    );
  };
  for (const type of ["pointerdown", "pointerup", "click"])
    document.addEventListener(type, trace, true);
  const input = async (method: string, params: object) => {
    await nativeFetch("/input", {
      method: "POST",
      body: JSON.stringify({ method, params }),
    });
  };
  function Probe({ kind }: { kind: "notice" | "update" | "reload" }) {
    const [visible, setVisible] = useState(true);
    store.clearNotice = () => setVisible(false);
    return (
      <>
        <div
          id="dismiss-underlay"
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            width: 360,
            zIndex: 5000,
          }}
        >
          <NeedsYouMessage
            item={{
              kind: "asks",
              key: "ask:synthetic-pointer",
              leaf: null,
              ask: {
                id: "synthetic-pointer",
                at: 0,
                actor: { label: "Synthetic agent", verified: true },
                question: "Keep this question open",
                options: ["Keep"],
                owner_only: true,
              },
            }}
            now={0}
            focused={false}
            stop={null}
            onChat={() => {
              dismissals++;
            }}
            onOpenTerminal={() => {
              dismissals++;
            }}
            onAnswer={async () => {
              dismissals++;
              return null;
            }}
            onDismiss={async () => {
              dismissals++;
              return null;
            }}
            onReviewed={async () => {
              dismissals++;
              return true;
            }}
          />
        </div>
        {kind === "notice" ? (
          <AppToasts
            status="disconnected"
            updateInfo={null}
            dismissedUpdateVersion={null}
            updateInstalling={false}
            notice={
              visible
                ? { id: 42, kind: "info", message: "Synthetic notice" }
                : null
            }
            onNoticeAction={() => {}}
          />
        ) : visible ? (
          <div className="toast-viewport">
            {kind === "update" ? (
              <UpdateToast
                info={{
                  current_version: "1.0.0",
                  latest_version: "1.2.3",
                  update_available: true,
                  can_auto_update: false,
                  platform: "linux-x64",
                }}
                dismissedVersion={null}
                installing={false}
                onDismiss={() => setVisible(false)}
                onInstall={() => {
                  throw new Error("No native actions in pointer fixture");
                }}
              />
            ) : (
              <StaleBuildToast
                offer={{
                  kind: "build",
                  loaded: "synthetic-old",
                  served: "synthetic-new",
                }}
                onDismiss={() => setVisible(false)}
              />
            )}
          </div>
        ) : null}
      </>
    );
  }
  const originalClear = store.clearNotice;
  try {
    for (const kind of ["notice", "update", "reload"] as const) {
      for (const touch of [false, true, null]) {
        events.length = 0;
        dismissals = 0;
        flushSync(() =>
          root.render(<Probe key={`${kind}-${touch}`} kind={kind} />),
        );
        await frame();
        await Promise.all(
          document
            .querySelector(".toast")!
            .getAnimations()
            .map((a) => a.finished.catch(() => {})),
        );
        const close = document.querySelector<HTMLButtonElement>(
          ".toast .close-button",
        )!;
        const r = close.getBoundingClientRect();
        const underlay = document.getElementById("dismiss-underlay")!;
        const under =
          underlay.querySelector<HTMLButtonElement>(".needs-you-icon")!;
        const u = under.getBoundingClientRect();
        underlay.style.transform = `translate(${r.x + r.width / 2 - u.x - u.width / 2}px, ${r.y + r.height / 2 - u.y - u.height / 2}px)`;
        const point = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        let underlyingDowns = 0;
        underlay.addEventListener("pointerdown", () => underlyingDowns++);
        check(
          document.elementFromPoint(point.x, point.y) === close,
          `${kind}: X not hit-testable before input`,
        );
        if (touch === null) {
          close.focus();
          for (const type of ["keyDown", "keyUp"])
            await input("Input.dispatchKeyEvent", {
              type,
              key: "Enter",
              windowsVirtualKeyCode: 13,
              ...(type === "keyDown" ? { text: "\r" } : {}),
            });
        } else if (touch) {
          await input("Emulation.setTouchEmulationEnabled", {
            enabled: true,
            maxTouchPoints: 1,
          });
          await input("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ ...point, id: 1 }],
          });
          await input("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
        } else {
          await input("Input.dispatchMouseEvent", {
            ...point,
            type: "mouseMoved",
          });
          for (const type of ["mousePressed", "mouseReleased"])
            await input("Input.dispatchMouseEvent", {
              ...point,
              type,
              button: "left",
              clickCount: 1,
            });
        }
        await frame();
        check(
          !document.querySelector(".toast"),
          `${kind}: ${touch ? "touch" : "mouse"} did not dismiss: ${events.join(",")}`,
        );
        check(
          dismissals === 0,
          `${kind}: clicked Needs you behind toast: ${events.join(",")}`,
        );
        if (touch === null) {
          for (const type of ["mousePressed", "mouseReleased"])
            await input("Input.dispatchMouseEvent", {
              ...point,
              type,
              button: "left",
              clickCount: 1,
            });
          await frame();
          check(
            dismissals === 1,
            `${kind}: keyboard dismissal incorrectly blocked a later pointer action`,
          );
          continue;
        }
        if (touch) {
          await input("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ ...point, id: 2 }],
          });
          if (kind === "notice") {
            const started = performance.now();
            await until(() => performance.now() - started > 550);
          }
          await input("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
        } else {
          for (const type of ["mousePressed", "mouseReleased"])
            await input("Input.dispatchMouseEvent", {
              ...point,
              type,
              button: "left",
              clickCount: 2,
            });
        }
        await frame();
        check(
          underlyingDowns === 0,
          `${kind}: repeat pointerdown reached Needs you`,
        );
        check(
          dismissals === 0,
          `${kind}: repeated ${touch ? "touch" : "mouse"} dismissal activated Needs you: ${events.join(",")}`,
        );
        // A separate control remains usable immediately, outside the repeat area.
        const answer = underlay.querySelector<HTMLButtonElement>(
          ".needs-you-replies button",
        )!;
        const answerRect = answer.getBoundingClientRect();
        const other = {
          x: answerRect.x + answerRect.width / 2,
          y: answerRect.y + answerRect.height / 2,
        };
        check(
          Math.hypot(other.x - point.x, other.y - point.y) > 24,
          "Unrelated action must be outside guard",
        );
        for (const type of ["mousePressed", "mouseReleased"])
          await input("Input.dispatchMouseEvent", {
            ...other,
            type,
            button: "left",
            clickCount: 1,
          });
        await frame();
        check(dismissals === 1, `${kind}: unrelated answer stopped working`);
        const ended = performance.now();
        await until(() => performance.now() - ended > 550);
        for (const type of ["mousePressed", "mouseReleased"])
          await input("Input.dispatchMouseEvent", {
            ...point,
            type,
            button: "left",
            clickCount: 1,
          });
        await frame();
        check(dismissals === 2, `${kind}: guard did not expire`);
      }
    }
  } finally {
    store.clearNotice = originalClear;
    for (const type of ["pointerdown", "pointerup", "click"])
      document.removeEventListener(type, trace, true);
    flushSync(() => root.render(null));
  }
}

async function run() {
  await checkDismissPointerIsolation();
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

  // A different served build is offered, never loaded by itself.
  let unloads = 0;
  addEventListener("beforeunload", () => unloads++);
  const toastTitled = (title: string) => () =>
    [...document.querySelectorAll<HTMLElement>(".toast")].find((toast) =>
      toast.querySelector("strong")?.textContent?.includes(title),
    );
  const differentBuild = toastTitled(
    "The service now serves a different Herdr World build",
  );
  const chunkReload = toastTitled("Reload to finish loading Herdr World");
  const later = (toast: HTMLElement) =>
    [...toast.querySelectorAll("button")]
      .find((button) => button.textContent === "Later")
      ?.click();
  const setStatus = (status: "connected" | "disconnected") =>
    __storeTesting.replaceState({ ...store.get(), status });
  // Waits for the build check a trigger starts to fetch and settle.
  const checkAfter = async (trigger: () => void) => {
    const before = buildChecks;
    trigger();
    await until(() => buildChecks > before);
    for (let i = 0; i < 3; i++) await frame();
  };
  check(!differentBuild(), "Unchanged build offered a reload");
  servedEntry = "/assets/index-next.js";
  // A restarted service drops the socket; reconnecting asks again.
  setStatus("disconnected");
  await frame();
  await checkAfter(() => setStatus("connected"));
  await until(differentBuild);
  check(
    differentBuild()!.textContent?.includes("index-next"),
    "Different build notice does not name the served build",
  );
  later(differentBuild()!);
  await until(() => !differentBuild());
  await checkAfter(() => dispatchEvent(new Event("online")));
  check(!differentBuild(), "Dismissed build was offered again");

  // A lazy part missing after Later is offered too, not reloaded. Like
  // Settings, a dialog stays open until its own onClose; like Ranger, a panel
  // stays mounted once opened and follows its open prop. Opening either again
  // must ask again.
  for (const retained of [false, true]) {
    const Missing = lazyWithReload<
      ComponentType<{ open: boolean; onClose: () => void }>
    >(`update-fixture-missing-${retained}-${Date.now()}`, () =>
      Promise.reject(new Error("chunk 404")),
    );
    let partOpen = false;
    let openPart = () => {};
    function PartHost() {
      const [open, setOpen] = useState(false);
      const [mounted, setMounted] = useState(false);
      partOpen = open;
      openPart = () => {
        setOpen(true);
        setMounted(true);
      };
      return (retained ? mounted : open) ? (
        <Suspense fallback={null}>
          <Missing open={open} onClose={() => setOpen(false)} />
        </Suspense>
      ) : null;
    }
    const host = createRoot(
      document.body.appendChild(document.createElement("div")),
    );
    flushSync(() => host.render(<PartHost />));
    for (let attempt = 0; attempt < 2; attempt++) {
      flushSync(() => openPart());
      await until(chunkReload);
      await until(() => !partOpen);
      check(
        !differentBuild(),
        "Missing part revived the dismissed build notice",
      );
      later(chunkReload()!);
      await until(() => !chunkReload());
    }
    host.unmount();
  }
  check(unloads === 0, "World reloaded the page by itself");
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
