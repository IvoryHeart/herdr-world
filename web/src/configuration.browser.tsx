import "./styles/tokens.css";
import "./styles/base.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { getChatTextScale } from "./textScales";
import { flushSync } from "react-dom";
import { bridge, type HerdrEventMsg } from "./api";
import { ConfigMenu } from "./components/ConfigMenu";
import type { AgentIntegration } from "./components/AgentIntegrationsSettings";
import { GlobalTooltip } from "./components/GlobalTooltip";
import { __storeTesting, OperationalContext, store } from "./store";
import { worldSourcesStore } from "./world/worldSources";
import {
  integrationsFixtureEnabled,
  resetIntegrationsFixture,
} from "./integrationsFixture";

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
const renderBoundary = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
const waitFor = async (predicate: () => boolean) => {
  for (let i = 0; i < 80 && !predicate(); i++) await settle();
  if (!predicate()) throw new Error("Timed out waiting for configuration");
};
const button = (label: string) => {
  const found = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button"),
  ).find(
    (element) =>
      element.getClientRects().length &&
      (element.getAttribute("aria-label") === label ||
        document.getElementById(element.getAttribute("aria-labelledby") ?? "")
          ?.textContent === label ||
        element.textContent === label ||
        element.querySelector("strong")?.textContent === label),
  );
  if (!found) throw new Error(`Missing visible button: ${label}`);
  return found;
};
const click = (label: string) => {
  const element = button(label);
  element.focus();
  flushSync(() => element.click());
};
// Settings: its category tabs, a choice row, and its pages.
const tab = (label: string) => {
  const found = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      '.settings-home-tabs [role="tab"]',
    ),
  ).find((element) => element.firstChild?.textContent === label);
  if (!found) throw new Error(`Missing Settings tab: ${label}`);
  return found;
};
const choose = (setting: string, option: string) => {
  const found = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      `[role="group"][aria-label="${setting}"] button`,
    ),
  ).find((element) => element.textContent === option);
  if (!found) throw new Error(`Missing ${setting} option: ${option}`);
  flushSync(() => found.click());
};
const focusable = (root: Element) =>
  Array.from(
    root.querySelectorAll<HTMLElement>(
      "button:not(:disabled):not([tabindex='-1']), input:not(:disabled), select:not(:disabled), a[href]",
    ),
  ).filter((element) => element.getClientRects().length > 0);
const settingsPageLoaded = () =>
  !!document.querySelector(".settings-page") &&
  !document.querySelector(".settings-page > .settings-home-empty");
/** Opens a page of Settings from its list, at All when its tab is not open. */
const openPage = async (title: string) => {
  if (document.querySelector(".settings-page")) click("Back to Settings");
  if (!document.querySelector(`.settings-home [aria-label="Open ${title}"]`))
    flushSync(() => tab("All").click());
  click(`Open ${title}`);
  await waitFor(settingsPageLoaded);
};
/** Leaves a page for the list, so the page's settings unmount. */
const backToList = () => click("Back to Settings");
const closeSettings = () => click("Close Settings");
const openSettings = async () => {
  click("Menu");
  click("Settings");
  await waitFor(() => !!document.querySelector(".settings-home"));
  return document.querySelector<HTMLElement>(".settings-home")!;
};
const configurationTest = { click, loadingRace: false };
Object.assign(window, { configurationTest });
const fetchResult = window.fetch.bind(window);
const input = async (method: string, params: Record<string, unknown>) => {
  const response = await fetchResult("/input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  if (!response.ok) throw new Error("Trusted browser input failed");
};
const swipe = async (
  element: Element,
  dx: number,
  dy: number,
  cancel = false,
) => {
  const sheet = element.closest(".mobile-sheet") ?? element;
  const frames: DOMRect[] = [];
  const rect = element.getBoundingClientRect();
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  await input("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  for (let step = 1; step <= 6; step++) {
    await input("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + (dx * step) / 6, y: y + (dy * step) / 6 }],
    });
    await renderBoundary();
    frames.push(sheet.getBoundingClientRect());
  }
  const eventName = cancel ? "touchcancel" : "touchend";
  let released = false;
  const onRelease = () => {
    released = true;
  };
  sheet.addEventListener(eventName, onRelease, { once: true });
  try {
    await input("Input.dispatchTouchEvent", {
      type: cancel ? "touchCancel" : "touchEnd",
      touchPoints: [],
    });
    // CDP can acknowledge before the renderer handles release and starts settling.
    await waitFor(() => released);
  } finally {
    sheet.removeEventListener(eventName, onRelease);
  }
  await Promise.all(
    sheet
      .getAnimations({ subtree: true })
      .map((animation) => animation.finished.catch(() => {})),
  );
  await renderBoundary();
  return frames;
};
const key = async (element: Element, value: string, shiftKey = false) => {
  (element as HTMLElement).focus();
  const codes: Record<string, number> = {
    Tab: 9,
    Enter: 13,
    Escape: 27,
    ArrowRight: 39,
  };
  for (const type of ["keyDown", "keyUp"])
    await input("Input.dispatchKeyEvent", {
      type,
      key: value,
      windowsVirtualKeyCode: codes[value],
      text: type === "keyDown" && value === "Enter" ? "\r" : undefined,
      modifiers: shiftKey ? 8 : 0,
    });
  await settle();
};
// The Integrations registry and its owners, as the World service reports them.
const sourceRequests: Array<{ id: string; body: Record<string, unknown> }> = [];
const worldSources = [
  {
    id: "github",
    label: "GitHub",
    enabled: true,
    state: "connected",
    detail: "Signed in.",
    checkedAt: 1,
    lastSuccessAt: 1,
    itemCount: 2,
    config: { kind: "github", mergedDays: 7 },
  },
  {
    id: "jira",
    label: "Jira",
    enabled: false,
    state: "disabled",
    detail: "Off.",
    checkedAt: 1,
    lastSuccessAt: null,
    itemCount: 0,
    config: { kind: "jira", site: "", email: "", jql: "", tokenSet: false },
  },
];
const runtimeRow = (
  id: string,
  label: string,
  lifecycle: string,
  runtimeGeneration: number,
) => ({
  id: `runtime:${id}`,
  kind: "runtime",
  type: "herdr",
  label,
  provides: ["terminals", "agents", "files"],
  state: lifecycle === "ready" ? "connected" : "available",
  detail: lifecycle === "ready" ? "Herdr · Ready" : "Herdr · Disconnected",
  settings: [],
  control: "connection",
  connection: {
    id,
    generation: runtimeGeneration,
    transport: id === "alpha" ? "local" : "ssh",
    lifecycle,
  },
});
let betaRuntimeGeneration = 4;
const integrationsSnapshot = () => ({
  observedAt: 1,
  integrations: [
    runtimeRow("alpha", "Alpha", "ready", 1),
    runtimeRow("beta", "Beta", "disconnected", betaRuntimeGeneration),
    ...worldSources.map((source) => ({
      id: `source:${source.id}`,
      kind: "source",
      type: source.id,
      label: source.label,
      provides: [source.id === "github" ? "pull_requests" : "tickets"],
      state: source.enabled
        ? "connected"
        : source.id === "jira"
          ? "needs_connect"
          : "available",
      detail: source.detail,
      settings: [],
      control: "source",
    })),
    {
      id: "source:metrics",
      kind: "source",
      type: "prometheus",
      label: "Usage metrics",
      provides: ["usage"],
      state: "needs_connect",
      detail: "Add a Prometheus URL to show usage and cost.",
      settings: [],
      control: "metrics",
    },
  ],
  vault: {
    backend: "file",
    label: "Private file",
    detail: "Readable only by the user that runs World.",
    secrets: [
      { name: "jira.token", label: "Jira API token", usedBy: "source:jira" },
    ],
  },
});
let registryReads = 0;
const worldFetch = (url: string, init?: RequestInit) => {
  if (url === "/api/world/integrations") {
    registryReads++;
    return Response.json(integrationsSnapshot());
  }
  if (url === "/api/world/sources" || url.startsWith("/api/world/sources?"))
    return Response.json({
      observedAt: 1,
      refreshing: false,
      sources: worldSources,
      items: [],
      links: [],
      actions: [],
    });
  const source = /^\/api\/world\/sources\/(github|jira)$/u.exec(url)?.[1];
  if (source && init?.method === "PUT") {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    sourceRequests.push({ id: source, body });
    const entry = worldSources.find((item) => item.id === source)!;
    if (typeof body.enabled === "boolean") {
      entry.enabled = body.enabled;
      entry.state = body.enabled ? "connected" : "disabled";
    }
    return Response.json({
      observedAt: 2,
      refreshing: false,
      sources: worldSources,
      items: [],
      links: [],
      actions: [],
    });
  }
  if (url === "/api/world/observability/configuration")
    return Response.json({
      providerId: "prometheus",
      configured: false,
      endpoint: null,
      source: "none",
      health: "unavailable",
      healthReason: null,
      observedAt: 1,
      lastSuccessAt: null,
    });
  return null;
};
let authRequired = false;
let logoutAttempts = 0;
let pendingLogout: Promise<Response> | null = null;
Object.defineProperty(window, "fetch", {
  configurable: true,
  value: async (url: string, init?: RequestInit) => {
    if (url === "/api/logout") {
      logoutAttempts++;
      check(init?.method === "POST", "logout must use POST");
      check(
        new Headers(init?.headers).get("x-roamgate-logout") === "1",
        "logout omitted CSRF header",
      );
      return pendingLogout ?? new Response(null, { status: 500 });
    }
    const world = worldFetch(url, init);
    if (world) return world;
    return Response.json({
      version: "0.9.1",
      protocol: 22,
      auth_required: authRequired,
    });
  },
});
let active = "alpha";
let generation = 1;
const settings: Record<string, boolean> = { alpha: true, beta: false };
const autoRenameSettings: Record<string, boolean> = {
  alpha: true,
  beta: false,
};
const listeners = new Set<(event: HerdrEventMsg) => void>();
const calls: Array<{ id: string; method: string; params: any }> = [];
let pendingRead: Promise<{ surface_codecs: boolean }> | null = null;
let failSave = false;
let failRead = false;
const integrations: Record<string, AgentIntegration[]> = Object.fromEntries(
  ["alpha", "beta"].map((id) => [
    id,
    [
      {
        target: "antigravity_cli",
        label: "Antigravity CLI",
        command: "agy",
        available: true,
        state: "not_installed",
      },
      {
        target: "pi",
        label: "Pi",
        command: "pi",
        available: true,
        state: "outdated",
        installed_version: 7,
        available_version: 9,
      },
      {
        target: "claude",
        label: "Claude Code",
        command: "claude",
        available: false,
        state: "current",
      },
      {
        target: "future_agent",
        label: "Future Agent",
        command: "future",
        available: false,
        state: "not_installed",
      },
    ],
  ]),
);
let integrationRead: Promise<unknown> | null = null;
let integrationChange: Promise<unknown> | null = null;
let integrationLoadFailure = false;
let integrationSaveFailure = false;
let malformedIntegrations = false;
let confirmChange = true;
const confirmations: string[] = [];
window.confirm = (message) => {
  confirmations.push(String(message));
  return confirmChange;
};
// World's own skill rows (world.integration.*) have focused DOM tests.
let worldIntegrationLists = 0;
const bridgeCall = bridge.call.bind(bridge);
const worldConnectionCalls: Array<{ method: string; id: unknown }> = [];
bridge.call = ((method: string, ...rest: unknown[]) => {
  if (method === "world.integration.list") worldIntegrationLists++;
  if (method === "connections.connect" || method === "connections.disconnect") {
    worldConnectionCalls.push({
      method,
      id: (rest[0] as { id?: unknown } | undefined)?.id,
    });
    return Promise.resolve({});
  }
  return method.startsWith("world.integration.")
    ? Promise.resolve({ integrations: [] })
    : bridgeCall(method, ...(rest as []));
}) as typeof bridge.call;
// Like the real bridge, a client captures the runtime lease when created; a
// reconnect drops the lease until World's catalog restores it.
let runtimeLeaseReady = true;
bridge.onEvent = (listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
bridge.connection = (id) => {
  const connectionId = id ?? active;
  const lease = generation;
  const leased = runtimeLeaseReady;
  return {
    connectionId,
    generation: lease,
    serverRuntimeGeneration: lease,
    isCurrent: () => leased && active === connectionId && lease === generation,
    acceptsServerGeneration: (value) => value === lease,
    call: async (method, params) => {
      calls.push({ id: connectionId, method, params });
      if (method === "settings.agent_auto_rename.get")
        return { enabled: autoRenameSettings[connectionId] };
      if (method === "settings.agent_auto_rename.update") {
        autoRenameSettings[connectionId] = params!.enabled as boolean;
        return { enabled: autoRenameSettings[connectionId] };
      }
      if (method === "settings.terminal_transport.get") {
        if (failRead) throw new Error("Load failed");
        return pendingRead ?? { surface_codecs: settings[connectionId] };
      }
      if (method === "settings.terminal_transport.update") {
        if (failSave) throw new Error("Save failed");
        settings[connectionId] = params!.surface_codecs as boolean;
        return { surface_codecs: settings[connectionId] };
      }
      if (method === "integration.list") {
        if (integrationLoadFailure)
          throw new Error("unknown method: integration.list");
        if (malformedIntegrations)
          return { integrations: [{ state: "surprise" }] };
        return (
          integrationRead ?? {
            type: "integration_list",
            integrations: structuredClone(integrations[connectionId]),
          }
        );
      }
      if (
        method === "integration.install" ||
        method === "integration.uninstall"
      ) {
        if (integrationSaveFailure)
          throw new Error("Configuration is not writable");
        if (integrationChange) return integrationChange;
        const item = integrations[connectionId].find(
          (item) => item.target === params?.target,
        )!;
        item.state =
          method === "integration.install" ? "current" : "not_installed";
        if (method === "integration.install") {
          if (item.available_version !== undefined)
            item.installed_version = item.available_version;
        } else {
          delete item.installed_version;
        }
        return {
          type: method.replace(".", "_"),
          target: item.target,
          details: { messages: [`Updated ${item.label} configuration`] },
        };
      }
      if (method === "settings.workspace_auto_sync.list")
        return { configs: [] };
      return {};
    },
  };
};
// A World view wraps the menu in its selection's context, or in an empty one
// when nothing is selected.
let worldViewContext: OperationalContext | null = null;
function Harness() {
  const [theme, setTheme] = useState<"light" | "dark" | "system">("dark");
  const [scale, setScale] = useState(
    Number(new URLSearchParams(location.search).get("scale") ?? 100),
  );
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.zoom = String(scale / 100);
  document.documentElement.style.setProperty("--ui-scale", String(scale / 100));
  document.documentElement.style.setProperty(
    "--config-sheet-max-height",
    `min(calc(78dvh / ${scale / 100}), calc(640px / ${scale / 100}))`,
  );
  return (
    <OperationalContext.Provider value={worldViewContext}>
      <ConfigMenu
        onShowShortcuts={() => {}}
        theme={theme}
        accentColor="blue"
        blackBackground={false}
        onBlackBackgroundChange={() => {}}
        uiScale={scale}
        terminalFontName=""
        onTerminalFontNameChange={() => {}}
        terminalFontScale={100}
        onTerminalFontScaleChange={() => {}}
        zenMode={false}
        mobileTerminalShortcuts={[[], []]}
        mobileTerminalSideShortcuts={[]}
        terminalThemeSelection={{ dark: "default", light: "default" }}
        customTerminalThemes={[]}
        onThemeChange={setTheme}
        onAccentColorChange={() => {}}
        onUiScaleChange={setScale}
        onZenModeChange={() => {}}
        onMobileTerminalShortcutsChange={() => {}}
        onMobileTerminalSideShortcutsChange={() => {}}
        onTerminalThemeSelectionChange={() => {}}
        onCustomTerminalThemesChange={() => {}}
      />
    </OperationalContext.Provider>
  );
}
let render = () => {};
const selectConnection = (id: string) => {
  active = id;
  generation++;
  flushSync(() =>
    __storeTesting.replaceState({
      ...store.get(),
      activeConnectionId: id,
      connectionGeneration: generation,
    }),
  );
  flushSync(render);
};
const integrationRow = (id: string) =>
  document.querySelector<HTMLElement>(`[data-integration="${id}"]`);
const kindTab = (kind: string) =>
  document.querySelector<HTMLButtonElement>(
    `.integrations-tabs [role="tab"][data-kind="${kind}"]`,
  );
const kindTabs = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>('.integrations-tabs [role="tab"]'),
    (tab) => tab.dataset.kind,
  ).join(",");
const tabCount = (kind: string) =>
  kindTab(kind)?.querySelector(".integrations-tab-count")?.textContent;
const openKind = (kind: string) => {
  const tab = kindTab(kind);
  if (!tab) throw new Error(`Missing Integrations tab: ${kind}`);
  flushSync(() => tab.click());
};
const kindGroups = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>(".integrations-kind:not([hidden])"),
    (group) => group.dataset.kind,
  ).join(",");
const rowStates = () =>
  JSON.stringify(
    Object.fromEntries(
      Array.from(
        document.querySelectorAll<HTMLElement>(".integration-row"),
        (row) => [row.dataset.integration, row.dataset.state],
      ),
    ),
  );
const searchIntegrations = (value: string) => {
  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="Search integrations"]',
  )!;
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!.call(input, value);
  flushSync(() => input.dispatchEvent(new Event("input", { bubbles: true })));
};
// The screen's look, on All: every row leads with its product's mark in one
// tile, keeps its actions beside its copy down to phone width, kind tabs stay
// quieter than Configuration's own section buttons, the Vault sits apart at
// the end, and each kind's own action sits on its heading.
function integrationsLayout(dialog: Element) {
  const rect = (element: Element | null | undefined) =>
    element?.getBoundingClientRect();
  for (const row of dialog.querySelectorAll<HTMLElement>(
    ".integration-row[data-integration]",
  )) {
    const icon = row.querySelector<HTMLElement>(":scope > .integration-icon");
    const tile = rect(icon);
    const copy = rect(row.querySelector(":scope > .integration-row-copy"));
    const actions = rect(
      row.querySelector(":scope > .integration-row-actions"),
    );
    check(
      !!tile && icon?.offsetWidth === 27 && !!copy && tile.right <= copy.left,
      `${row.dataset.integration} has no icon tile before its copy`,
    );
    if (innerWidth > 350 && actions && copy && actions.width)
      check(
        actions.left >= copy.right - 1 &&
          actions.top < copy.bottom &&
          actions.bottom > copy.top,
        `${row.dataset.integration} actions left its row's side: ${JSON.stringify({ actions, copy })}`,
      );
  }
  check(
    !!integrationRow("runtime:alpha")?.querySelector(
      '.integration-icon img[src="/herdr-icon.png"]',
    ) &&
      integrationRow("source:github")?.querySelector(
        ".integration-icon svg title",
      )?.textContent === "Github",
    "Herdr and GitHub rows do not show their own marks",
  );
  const tab = kindTab("runtime")!;
  check(
    !tab.querySelector("svg") &&
      getComputedStyle(tab).borderTopWidth === "0px" &&
      getComputedStyle(tab).borderBottomWidth !== "0px",
    "kind tabs are not quiet underlined tabs",
  );
  const tabs = Array.from(
    dialog.querySelectorAll<HTMLElement>(".integrations-tabs [role='tab']"),
  );
  const vault = kindTab("vault")!;
  check(
    tabs[tabs.length - 1] === vault &&
      !!vault.querySelector("svg") &&
      (innerWidth <= 600 ||
        vault.getBoundingClientRect().left -
          tabs[tabs.length - 2].getBoundingClientRect().right >
          8),
    "the Vault tab does not sit apart from the kinds",
  );
  const hosts = Array.from(dialog.querySelectorAll("button")).find(
    (button) => button.textContent === "Add or edit hosts…",
  );
  check(
    !!hosts?.closest(
      '.integrations-kind[data-kind="runtime"] .integrations-kind-head',
    ),
    "Add or edit hosts… is not on the Runtimes heading",
  );
  const intro = dialog.querySelector(".integrations-intro")!;
  const help = dialog.querySelector(
    '.integrations-kind[data-kind="vault"] .integrations-help',
  );
  check(
    !!help &&
      getComputedStyle(help).fontSize === getComputedStyle(intro).fontSize,
    "the Vault's help is not set like the screen's other help text",
  );
}

// One screen, one tab per kind the registry reports, lists every runtime and
// source with its state and one action, and the vault by names only.
async function integrationsScreen(dialog: Element) {
  await waitFor(() => !!integrationRow("runtime:alpha"));
  check(
    kindTabs() === "all,runtime,source,harness,vault",
    `Integrations tabs are not All, the registry's kinds and Vault: ${kindTabs()}`,
  );
  // All opens first and lists every kind under its heading; the Agents list
  // counts the agents it shows on its host.
  // Pi, Claude Code and Antigravity CLI; Future Agent is not detected.
  await waitFor(() => tabCount("harness") !== undefined);
  check(
    tabCount("harness") === "3",
    `the Agents tab does not count its listed agents: ${tabCount("harness")}`,
  );
  check(
    kindTab("all")!.getAttribute("aria-selected") === "true" &&
      tabCount("all") === "8" &&
      tabCount("runtime") === "2" &&
      tabCount("source") === "3" &&
      tabCount("vault") === "1",
    `All is not open or tabs do not count their rows: ${tabCount("all")}`,
  );
  check(
    kindGroups() === "runtime,source,harness,vault" &&
      document.querySelectorAll(".agent-integrations-list li").length === 4 &&
      !integrationRow("harness:claude"),
    `All does not list every kind once: ${kindGroups()}`,
  );
  integrationsLayout(dialog);
  openKind("runtime");
  check(
    rowStates() ===
      JSON.stringify({
        "runtime:alpha": "connected",
        "runtime:beta": "available",
      }),
    `Runtimes tab rows or states are wrong: ${rowStates()}`,
  );
  check(
    integrationRow("runtime:alpha")!.textContent!.includes(
      "Gives World terminals, agents, files.",
    ),
    "a runtime row does not say what it provides",
  );
  // The vault is its own tab: the tokens it holds by name and who uses them.
  openKind("vault");
  const token = dialog.querySelector('[data-secret="jira.token"]');
  check(
    !dialog.querySelector(".integration-row[data-integration]") &&
      !!token?.textContent?.includes("Jira API token") &&
      token.textContent.includes("Used by Jira."),
    "the Vault tab does not name what it holds",
  );
  openKind("runtime");
  check(
    dialog.scrollWidth <= dialog.clientWidth + 1,
    "the Integrations screen overflows the viewport",
  );

  // A runtime row acts on the exact connection it showed.
  click("Connect Beta");
  await waitFor(() => worldConnectionCalls.length === 1);
  check(
    worldConnectionCalls[0].method === "connections.connect" &&
      worldConnectionCalls[0].id === "beta",
    "Connect did not connect that runtime",
  );
  await waitFor(() => !button("Connect Beta").disabled);
  betaRuntimeGeneration++;
  click("Connect Beta");
  await waitFor(
    () =>
      !!dialog
        .querySelector('[role="alert"]')
        ?.textContent?.includes("changed since this list was read"),
  );
  check(
    worldConnectionCalls.length === 1,
    "a replaced runtime was acted on from a stale row",
  );

  // Sources switch off at once; one that needs settings opens them instead.
  openKind("source");
  check(
    rowStates() ===
      JSON.stringify({
        "source:github": "connected",
        "source:jira": "needs_connect",
        "source:metrics": "needs_connect",
      }),
    `Sources tab rows or states are wrong: ${rowStates()}`,
  );
  await waitFor(() => !button("Disconnect GitHub").disabled);
  click("Disconnect GitHub");
  await waitFor(() => sourceRequests.length === 1);
  check(
    sourceRequests[0].id === "github" &&
      sourceRequests[0].body.enabled === false,
    "Disconnect did not switch GitHub off",
  );
  await waitFor(
    () => integrationRow("source:github")?.dataset.state === "available",
  );
  click("Connect GitHub");
  await waitFor(() => sourceRequests.length === 2);
  check(
    sourceRequests[1].body.enabled === true,
    "Connect did not switch GitHub on",
  );
  await waitFor(() => !button("Connect Jira").disabled);
  click("Connect Jira");
  await waitFor(
    () => !!dialog.querySelector('form[aria-label="Jira settings"]'),
  );
  check(
    sourceRequests.length === 2,
    "Connect Jira acted before its settings were filled in",
  );
  click("Jira settings");
  check(
    !dialog.querySelector('form[aria-label="Jira settings"]'),
    "Jira settings did not close",
  );
  click("Connect Usage metrics");
  await waitFor(
    () => !!dialog.querySelector('form[aria-label="Usage metrics settings"]'),
  );
  click("Usage metrics settings");

  // The service refreshes sources on its own: a refresh that finishes while
  // the screen is open moves the row without another registry read, both to
  // a failure and back to connected.
  await waitFor(
    () => integrationRow("source:github")?.dataset.state === "connected",
  );
  const github = worldSources.find((item) => item.id === "github")!;
  // A poll already on its way carries the old answer; the next one is new.
  const refreshSources = async () => {
    await worldSourcesStore.refresh();
    await worldSourcesStore.refresh();
  };
  const reads = registryReads;
  github.state = "error";
  github.detail = "Sign-in expired.";
  await refreshSources();
  await waitFor(
    () =>
      integrationRow("source:github")?.dataset.state === "error" &&
      integrationRow("source:github")!.textContent!.includes(
        "Sign-in expired.",
      ),
  );
  github.state = "connected";
  github.detail = "Signed in.";
  await refreshSources();
  await waitFor(
    () => integrationRow("source:github")?.dataset.state === "connected",
  );
  check(
    registryReads === reads,
    "a source refresh needed another registry read to reach the screen",
  );

  // Search always covers everything: typing opens All with every match,
  // the vault's tokens too, and each tab counts its matches.
  check(
    kindTab("source")!.getAttribute("aria-selected") === "true",
    "the Sources tab is not open before searching",
  );
  searchIntegrations("jira");
  await waitFor(() => tabCount("harness") === "0");
  check(
    kindTab("all")!.getAttribute("aria-selected") === "true" &&
      kindGroups() === "source,vault" &&
      rowStates() === JSON.stringify({ "source:jira": "needs_connect" }) &&
      !!dialog.querySelector('[data-secret="jira.token"]') &&
      tabCount("all") === "1" &&
      tabCount("source") === "1" &&
      tabCount("runtime") === "0" &&
      tabCount("vault") === "1",
    `search did not cover every integration: ${kindGroups()} ${rowStates()}`,
  );
  searchIntegrations("pi");
  await waitFor(() => tabCount("harness") === "1");
  check(
    kindGroups().split(",").includes("harness") &&
      document.querySelectorAll(".agent-integrations-list li").length === 1,
    `All search did not find an agent: ${kindGroups()}`,
  );
  // A tab narrows the results; an empty one points at the tabs that match.
  searchIntegrations("ssh");
  openKind("source");
  const empty = dialog.querySelector(".integrations-empty");
  check(
    !!empty?.textContent?.includes("No sources match “ssh”.") &&
      !dialog.querySelector(".integration-row"),
    "an empty search did not say so",
  );
  click("Runtimes (1)");
  check(
    kindTab("runtime")!.getAttribute("aria-selected") === "true" &&
      rowStates() === JSON.stringify({ "runtime:beta": "available" }),
    `a match in another tab could not be reached: ${rowStates()}`,
  );
  searchIntegrations("");
  openKind("all");
  searchIntegrations("nothing like this");
  await waitFor(() => tabCount("harness") === "0");
  check(
    kindGroups() === "" &&
      !!dialog
        .querySelector(".integrations-empty")
        ?.textContent?.includes("Nothing matches “nothing like this”."),
    `a search with no match anywhere did not say so: ${kindGroups()}`,
  );
  searchIntegrations("");

  // Dozens of rows and a new kind (the preview fixture): the kind gets its
  // own tab, the tabs scroll on one row, and search still narrows.
  history.replaceState(history.state, "", "?integrationsFixture");
  resetIntegrationsFixture();
  check(
    integrationsFixtureEnabled() && !location.search.includes("integrations"),
    "the integrations fixture switch was not consumed at once",
  );
  searchIntegrations("sample");
  check(
    kindTabs() === "all,runtime,source,harness,ide,vault" &&
      kindTab("all")!.getAttribute("aria-selected") === "true" &&
      tabCount("runtime") === "14" &&
      tabCount("source") === "18" &&
      tabCount("ide") === "8",
    `a new kind did not get its own counted tab: ${kindTabs()}`,
  );
  const tabs = dialog.querySelector<HTMLElement>(".integrations-tabs")!;
  check(
    dialog.scrollWidth <= dialog.clientWidth + 1 &&
      new Set(
        Array.from(tabs.children, (tab) =>
          Math.round(tab.getBoundingClientRect().top),
        ),
      ).size === 1,
    "many kinds overflow the screen or wrap the tabs",
  );
  openKind("ide");
  searchIntegrations("sample error");
  check(
    rowStates() ===
      JSON.stringify({
        "ide:sample-04": "error",
        "ide:sample-08": "error",
      }) && !dialog.querySelector(".integration-row button"),
    `search by status failed or sample rows can act: ${rowStates()}`,
  );
  resetIntegrationsFixture();
  history.replaceState(history.state, "", location.pathname);
  searchIntegrations("");
  check(
    kindTabs() === "all,runtime,source,harness,vault" &&
      kindTab("all")!.getAttribute("aria-selected") === "true",
    "a kind that left kept its tab open",
  );

  // Agents keep their per-host list; the same search narrows it.
  openKind("harness");
  await waitFor(
    () => document.querySelectorAll(".agent-integrations-list li").length === 4,
  );
  searchIntegrations("pi");
  openKind("harness");
  check(
    document.querySelectorAll(".agent-integrations-list li").length === 1 &&
      document
        .querySelector(".agent-integrations-list li")!
        .textContent!.includes("Pi"),
    "search did not narrow the agent list",
  );
  searchIntegrations("nothing like this");
  check(
    !!dialog
      .querySelector(".agent-integrations-settings")
      ?.textContent?.includes("No agent matches"),
    "an agent search with no match did not say so",
  );
  searchIntegrations("");
}
async function run() {
  const viewportSmoke = new URLSearchParams(location.search).has(
    "viewportSmoke",
  );
  document.documentElement.dataset.layout =
    innerWidth <= 600 ? "mobile" : "desktop";
  __storeTesting.replaceState({
    ...store.get(),
    activeConnectionId: active,
    connectionGeneration: generation,
    status: "connected",
    connections: [
      {
        id: "alpha",
        label: "Local test",
        source: "local",
        is_default: true,
        state: "ready",
        generation: 1,
      },
      {
        id: "beta",
        label: "Remote test",
        source: "ssh",
        ssh_destination: "user@example.test",
        is_default: false,
        state: "ready",
        generation: 1,
      },
    ],
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  render = () =>
    root.render(
      <>
        <Harness />
        <GlobalTooltip />
      </>,
    );
  flushSync(render);
  click("Menu");
  await settle();
  // The Menu holds the few things people do every day; Settings holds the rest.
  for (const label of ["Settings", "Find or act", "Zen mode", "Help"])
    check(
      (() => {
        try {
          return !!button(label);
        } catch {
          return false;
        }
      })(),
      `the Menu has no ${label} row`,
    );
  // Help's own description names the tutorial; no row is titled with it.
  for (const label of ["Configuration", "Reload page", "Tutorial"])
    check(
      !Array.from(
        document.querySelectorAll("#herdr-world-config-menu strong"),
      ).some((element) => element.textContent === label),
      `the Menu still lists ${label}`,
    );
  check(
    !Array.from(document.querySelectorAll("button")).some((element) =>
      element.textContent?.includes("Log out"),
    ),
    "auth-disabled server offers logout",
  );
  click("Menu");
  authRequired = true;
  click("Menu");
  await waitFor(
    () =>
      !!Array.from(document.querySelectorAll("button")).find(
        (element) => element.querySelector("strong")?.textContent === "Log out",
      ),
  );
  const failedLogout = Promise.withResolvers<Response>();
  pendingLogout = failedLogout.promise;
  click("Log out");
  check(
    button("Logging out...").disabled,
    "logout allows duplicate submissions",
  );
  failedLogout.resolve(new Response(null, { status: 500 }));
  await waitFor(() => !!document.querySelector(".config-logout-error"));
  check(
    !button("Log out").disabled && logoutAttempts === 1,
    "failed logout cannot be retried",
  );
  pendingLogout = null;
  click("Menu");
  click("Menu");
  await waitFor(
    () =>
      !!Array.from(document.querySelectorAll("button")).find(
        (element) => element.querySelector("strong")?.textContent === "Log out",
      ),
  );
  check(
    !document.querySelector(
      "#herdr-world-config-menu [aria-label='Task notifications']",
    ),
    "preferences still live in Menu",
  );
  const mobile = document.documentElement.dataset.layout === "mobile";
  if (mobile && !viewportSmoke) {
    for (const theme of ["dark", "light"]) {
      document.documentElement.dataset.theme = theme;
      const menu = document.querySelector<HTMLElement>(".config-dropdown")!;
      const handle = menu.querySelector(".mobile-sheet-handle")!;
      const content = menu.querySelector(".config-dropdown-content")!;
      await Promise.all(
        menu
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => {})),
      );
      const rect = menu.getBoundingClientRect();
      for (const label of ["Settings", "Find or act", "Help", "Log out"]) {
        const row = button(label);
        check(
          getComputedStyle(row).visibility === "visible" &&
            (row.getBoundingClientRect().bottom <= rect.bottom ||
              content.scrollHeight > content.clientHeight),
          `${theme}: the Menu hides ${label}`,
        );
      }
      await swipe(handle, 0, -60);
      check(
        menu.isConnected &&
          Math.abs(menu.getBoundingClientRect().top - rect.top) < 1 &&
          Math.abs(menu.getBoundingClientRect().height - rect.height) < 1,
        `${theme}: an upward drag moved or resized the Menu`,
      );
      await swipe(button("Settings"), 0, 60, true);
      check(
        menu.isConnected &&
          Math.abs(menu.getBoundingClientRect().top - rect.top) < 1,
        `${theme}: a cancelled drag did not spring back`,
      );
      check(
        !document.querySelector(".settings-home, .configuration-loading-modal"),
        "a drag opened Settings",
      );
      const closingFrames = await swipe(
        menu.querySelector(".config-summary")!,
        0,
        60,
      );
      check(
        Math.abs(closingFrames[closingFrames.length - 1].top - rect.top - 60) <
          2,
        "menu dismissal did not follow the finger",
      );
      check(
        !menu.isConnected && document.activeElement === button("Menu"),
        "swipe down did not close menu and restore focus",
      );
      click("Menu");
      // Tap where the row rests, not where the opening sheet passes.
      await Promise.all(
        document
          .getElementById("herdr-world-config-menu")!
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => {})),
      );
      await swipe(button("Zen mode"), 0, 0);
      // The Menu closes with an exit animation after the tap's click.
      await waitFor(() => !document.getElementById("herdr-world-config-menu"));
      click("Menu");
    }
  } else if (!viewportSmoke) {
    check(
      !document
        .querySelector<HTMLElement>(".mobile-sheet-handle")!
        .getClientRects().length,
      "desktop menu exposes mobile handle",
    );
  }
  if (new URLSearchParams(location.search).has("menuOnly")) {
    root.unmount();
    return;
  }
  click("Settings");
  // Lazy mounting exposes the DOM before the dialog's focus effect runs.
  // Wait for focus before dispatching keys, or that effect can steal it back.
  await waitFor(
    () =>
      !configurationTest.loadingRace &&
      !!document
        .querySelector(".settings-home")
        ?.contains(document.activeElement),
  );
  let dialog = document.querySelector<HTMLElement>(".settings-home")!;
  check(
    dialog.contains(document.activeElement),
    "Settings did not receive focus",
  );
  check(
    !document.getElementById("herdr-world-config-menu"),
    "Settings left the Menu open",
  );
  tab("All").focus();
  await key(tab("All"), "ArrowRight");
  check(
    tab("Appearance").getAttribute("aria-selected") === "true",
    "arrow key did not select Appearance",
  );
  check(
    document.activeElement === tab("Appearance"),
    "tab keyboard navigation lost focus",
  );
  for (const theme of ["Dark", "Light"]) {
    choose("Theme", theme);
    for (const item of document.querySelectorAll<HTMLElement>(
      ".settings-home-tabs [aria-selected='false']",
    )) {
      const style = getComputedStyle(item);
      check(
        parseFloat(style.borderTopWidth) > 0 &&
          style.borderTopStyle !== "none" &&
          style.borderTopColor !== "transparent" &&
          style.borderTopColor !== "rgba(0, 0, 0, 0)",
        `${theme}: inactive tab has no visible border`,
      );
    }
  }
  check(
    document.documentElement.dataset.theme === "light",
    "theme preference stopped working",
  );
  // Chat text follows the terminal size until set on its own; its value
  // button links it back.
  check(
    getChatTextScale() === null &&
      !!document.querySelector(
        '[aria-label="Follow the terminal, currently Terminal · 100%"]',
      ),
    "Chat text must start linked to the terminal font size",
  );
  click("Increase chat text size");
  await settle();
  check(
    getChatTextScale() === 105,
    `Chat text did not unlink (${getChatTextScale()})`,
  );
  click("Follow the terminal, currently 105%");
  await settle();
  check(
    getChatTextScale() === null,
    "Chat text did not link to the terminal again",
  );
  for (let i = 0; i < (innerWidth <= 320 ? 10 : 5); i++) {
    const increase = button("Increase interface size");
    if (increase.disabled) break;
    click("Increase interface size");
  }
  await settle();
  const rect = dialog.getBoundingClientRect();
  check(
    rect.left >= 0 &&
      rect.right <= innerWidth + 1 &&
      rect.bottom <= innerHeight + 1 &&
      rect.top >= 0,
    "scaled Settings exceeds viewport",
  );
  check(
    dialog.scrollWidth <= dialog.clientWidth + 1,
    "Settings overflows horizontally",
  );
  if (mobile) {
    check(
      Math.abs(rect.bottom - innerHeight) <= 1 && rect.left === 0,
      "Settings is not a bottom drawer",
    );
    const content = dialog.querySelector<HTMLElement>(
      ".configuration-content",
    )!;
    if (content.scrollHeight > content.clientHeight) {
      await swipe(content, 0, -60);
      check(
        content.scrollTop > 0 && dialog.isConnected,
        "drawer content could not scroll independently",
      );
      content.scrollTop = Math.min(
        20,
        content.scrollHeight - content.clientHeight,
      );
      await swipe(content, 0, 60);
      check(dialog.isConnected, "content scrolling dismissed the drawer");
      content.scrollTop = 0;
    }
  } else {
    check(
      rect.left > 0 && rect.bottom < innerHeight,
      "desktop Settings became a drawer",
    );
  }
  if (viewportSmoke) {
    root.unmount();
    return;
  }
  const controls = focusable(dialog);
  const firstControl = controls[0];
  const lastControl = controls[controls.length - 1];
  check(
    firstControl === button(mobile ? "Dismiss Settings" : "Close Settings"),
    "Settings does not start with its close control",
  );
  lastControl.focus();
  await key(lastControl, "Tab");
  check(document.activeElement === firstControl, "Tab escaped Settings");
  await key(firstControl, "Tab", true);
  check(document.activeElement === lastControl, "Shift+Tab escaped Settings");
  flushSync(() => tab("Agents").click());
  check(
    button("Open agents as a chat").getAttribute("aria-checked") === "false",
    "default pane view lost during Settings migration",
  );
  click("Open agents as a chat");
  check(
    button("Open agents as a chat").getAttribute("aria-checked") === "true",
    "Settings did not update the pane view",
  );
  click("Open agents as a chat");
  flushSync(() => tab("Keyboard").click());
  check(
    button("Vim keys in agent chats").getAttribute("aria-checked") === "false",
    "default Vim preference lost during Settings migration",
  );
  click("Vim keys in agent chats");
  check(
    button("Vim keys in agent chats").getAttribute("aria-checked") === "true",
    "Settings did not update the Vim preference",
  );
  click("Vim keys in agent chats");
  flushSync(() => tab("All").click());
  click("Open Layout");
  await waitFor(
    () =>
      !configurationTest.loadingRace &&
      !!document.querySelector("[aria-label='Layout Preferences']"),
  );
  check(
    !document.querySelector(".settings-home"),
    "Settings remains open behind the Layout dialog",
  );
  await key(document.activeElement!, "Escape");
  await waitFor(() => !!document.querySelector(".settings-home"));
  dialog = document.querySelector<HTMLElement>(".settings-home")!;
  await waitFor(() => document.activeElement === button("Open Layout"));
  await openPage("Automatic tab renaming");
  await waitFor(() => !button("Automatic tab renaming").disabled);
  check(
    button("Automatic tab renaming").getAttribute("aria-checked") === "true",
    "default auto-rename preference missing",
  );
  click("Automatic tab renaming");
  await waitFor(
    () =>
      button("Automatic tab renaming").getAttribute("aria-checked") === "false",
  );
  check(autoRenameSettings.alpha === false, "auto-rename preference not saved");
  await openPage("Terminal transport");
  await waitFor(
    () =>
      button("Terminal incremental transport").getAttribute("aria-disabled") ===
      "false",
  );
  check(
    button("Terminal incremental transport").getAttribute("aria-checked") ===
      "true",
    "default codec preference missing",
  );
  check(
    document.getElementById("terminal-transport-description")!.getClientRects()
      .length === 0,
    "transport description takes up dialog space",
  );
  const help = button("About terminal incremental transport");
  // Returning from Layout replays the parent dialog's entrance animation.
  // Let its layout and hit-test regions settle before sending pointer input;
  // movement or a pending scroll can otherwise cancel the hover tooltip.
  await Promise.all(
    dialog.getAnimations().map((animation) => animation.finished),
  );
  await renderBoundary();
  const helpBounds = help.getBoundingClientRect();
  await input("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: helpBounds.left + helpBounds.width / 2,
    y: helpBounds.top + helpBounds.height / 2,
  });
  await waitFor(() => !!document.querySelector("[role='tooltip']"));
  check(
    document
      .querySelector("[role='tooltip']")!
      .textContent!.includes("shared by all viewers"),
    "hover tooltip lost the shared-setting warning",
  );
  const checkTooltipBounds = () => {
    const bounds = document
      .querySelector<HTMLElement>("[role='tooltip']")!
      .getBoundingClientRect();
    check(
      bounds.left >= 0 &&
        bounds.right <= innerWidth &&
        bounds.top >= 0 &&
        bounds.bottom <= innerHeight,
      "tooltip exceeds the true scaled viewport",
    );
  };
  checkTooltipBounds();
  await input("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
  await waitFor(() => !document.querySelector("[role='tooltip']"));
  await key(button("Terminal incremental transport"), "Tab", true);
  check(
    document.activeElement === help,
    "keyboard cannot reach transport help",
  );
  await waitFor(() => !!document.querySelector("[role='tooltip']"));
  checkTooltipBounds();
  click("About terminal incremental transport");
  await waitFor(() => !!document.querySelector(".configuration-help-content"));
  await settle();
  const helpContent = document.querySelector<HTMLElement>(
    ".configuration-help-content",
  )!;
  const helpRect = helpContent.getBoundingClientRect();
  check(
    helpRect.left >= 0 &&
      helpRect.right <= innerWidth + 1 &&
      helpRect.top >= 0 &&
      helpRect.bottom <= innerHeight + 1,
    "help popover exceeds the scaled viewport",
  );
  check(
    helpContent.contains(
      document.elementFromPoint(
        helpRect.left + helpRect.width / 2,
        helpRect.top + helpRect.height / 2,
      ),
    ),
    "help popover is hidden behind Settings",
  );
  await key(helpContent, "Escape");
  await waitFor(() => !document.querySelector(".configuration-help-content"));
  await settle();
  check(
    dialog.isConnected && document.activeElement === help,
    "closing help closed Settings or lost focus",
  );
  click("Terminal incremental transport");
  await waitFor(
    () =>
      button("Terminal incremental transport").getAttribute("aria-checked") ===
      "false",
  );
  check(
    settings.alpha === false && calls[calls.length - 1]?.id === "alpha",
    "setting was not saved for the selected connection",
  );
  check(
    dialog.contains(document.activeElement),
    "saving moved focus out of Settings",
  );
  closeSettings();
  await settle();
  check(
    document.activeElement === button("Menu"),
    "closing Settings did not restore Menu focus",
  );
  dialog = await openSettings();
  await openPage("Automatic tab renaming");
  await waitFor(() => !button("Automatic tab renaming").disabled);
  check(
    button("Automatic tab renaming").getAttribute("aria-checked") === "false",
    "reopening discarded the auto-rename preference",
  );
  await openPage("Terminal transport");
  await waitFor(
    () =>
      button("Terminal incremental transport").getAttribute("aria-disabled") ===
      "false",
  );
  check(
    button("Terminal incremental transport").getAttribute("aria-checked") ===
      "false",
    "reopening discarded the saved preference",
  );
  failSave = true;
  click("Terminal incremental transport");
  await waitFor(() => !!document.querySelector("[role='alert']"));
  check(
    settings.alpha === false &&
      button("Terminal incremental transport").getAttribute("aria-checked") ===
        "false",
    "failed save silently changed the preference",
  );
  failSave = false;
  const retryStart = calls.length;
  click("Retry");
  await waitFor(
    () =>
      button("Terminal incremental transport").getAttribute("aria-checked") ===
      "true",
  );
  check(
    calls
      .slice(retryStart)
      .some(
        (call) =>
          call.method === "settings.terminal_transport.update" &&
          call.params?.surface_codecs === true,
      ),
    "Retry did not resubmit the failed save value",
  );
  settings.alpha = false;
  for (const listener of listeners)
    listener({
      event: "settings.terminal_transport.updated",
      connection_id: "alpha",
      connection_generation: generation,
      data: { surface_codecs: false },
    });
  await waitFor(
    () =>
      button("Terminal incremental transport").getAttribute("aria-checked") ===
      "false",
  );
  check(
    !document.querySelector("[role='alert']"),
    "successful save left a stale error",
  );
  const updatesBeforeLoadFailure = calls.filter(
    (call) => call.method === "settings.terminal_transport.update",
  ).length;
  backToList();
  failRead = true;
  await openPage("Terminal transport");
  await waitFor(() => !!document.querySelector("[role='alert']"));
  failRead = false;
  click("Retry");
  await waitFor(
    () =>
      button("Terminal incremental transport").getAttribute("aria-disabled") ===
      "false",
  );
  check(
    calls.filter((call) => call.method === "settings.terminal_transport.update")
      .length === updatesBeforeLoadFailure,
    "load Retry unexpectedly wrote settings",
  );
  let resolveRead!: (value: { surface_codecs: boolean }) => void;
  pendingRead = new Promise((resolve) => {
    resolveRead = resolve;
  });
  backToList();
  await openPage("Terminal transport");
  await settle();
  check(
    button("Terminal incremental transport").getAttribute("aria-disabled") ===
      "true",
    "unknown setting is interactive",
  );
  pendingRead = null;
  selectConnection("beta");
  await waitFor(
    () =>
      button("Terminal incremental transport").getAttribute("aria-disabled") ===
      "false",
  );
  resolveRead({ surface_codecs: true });
  await settle();
  check(
    button("Terminal incremental transport").getAttribute("aria-checked") ===
      "false",
    "late response crossed the connection boundary",
  );
  click("Terminal incremental transport");
  await waitFor(
    () =>
      button("Terminal incremental transport").getAttribute("aria-checked") ===
      "true",
  );
  check(
    settings.beta === true && settings.alpha === false,
    "update crossed the connection boundary",
  );
  check(
    !calls.some((call) => call.method.startsWith("integration.")),
    "integrations were fetched before opening their tab",
  );
  await openPage("Integrations");
  await integrationsScreen(dialog);
  await waitFor(
    () => document.querySelectorAll(".agent-integrations-list li").length === 4,
  );
  check(
    document
      .querySelector(".agent-integrations-settings")!
      .textContent!.includes("user@example.test"),
    "integration scope omitted the SSH destination",
  );
  check(
    dialog.scrollWidth <= dialog.clientWidth + 1,
    "integrations overflow the scaled viewport",
  );
  const mutationCount = () =>
    calls.filter(
      (call) =>
        call.method === "integration.install" ||
        call.method === "integration.uninstall",
    ).length;
  const beforeCancel = mutationCount();
  const firstIntegration = document.querySelector(
    ".agent-integrations-list li",
  )!;
  check(
    firstIntegration.textContent!.includes("Pi") &&
      firstIntegration.textContent!.includes("v7") &&
      firstIntegration.textContent!.includes("v9"),
    "upgrade row is not prioritized or is missing installed/available versions",
  );
  check(
    document
      .querySelector(".agent-integrations-settings")!
      .textContent!.includes("Version unavailable"),
    "missing version metadata was fabricated",
  );
  check(
    !!document.querySelector(
      '.agent-integrations-version [title*="server API and CLI"][title*="herdr integration status"]',
    ),
    "missing integration versions must explain the metadata sources and CLI check",
  );
  const otherAgents = document.querySelector<HTMLDetailsElement>(
    ".agent-integrations-unavailable",
  )!;
  check(!otherAgents.open, "undetected agents are not collapsed by default");
  await key(otherAgents.querySelector("summary")!, "Enter");
  check(otherAgents.open, "other agents cannot be expanded with the keyboard");
  click("Install Future Agent integration");
  check(mutationCount() === beforeCancel, "missing agent was installable");
  confirmChange = false;
  click("Install Antigravity CLI integration");
  click("Uninstall Claude Code integration");
  check(
    mutationCount() === beforeCancel,
    "cancelled integration change was submitted",
  );
  check(
    confirmations[confirmations.length - 1].includes(
      "Remote test (user@example.test)",
    ) &&
      confirmations[confirmations.length - 1].includes(
        "server user's agent configuration",
      ),
    "confirmation omitted the target and shared configuration warning",
  );
  confirmChange = true;
  click("Install Antigravity CLI integration");
  await waitFor(
    () =>
      !!document.querySelector(
        '[aria-label="Uninstall Antigravity CLI integration"]',
      ),
  );
  check(
    calls.some(
      (call) =>
        call.id === "beta" &&
        call.method === "integration.install" &&
        call.params.target === "antigravity_cli",
    ),
    "install did not preserve the server target or selected connection",
  );
  await waitFor(
    () =>
      button("Refresh integrations").getAttribute("aria-disabled") === "false",
  );
  check(
    document
      .querySelector('[role="status"].agent-integrations-status')!
      .textContent!.includes("Updated Antigravity CLI configuration"),
    "installation messages were not shown",
  );
  click("Update Pi integration");
  await waitFor(
    () => !document.querySelector('[aria-label="Update Pi integration"]'),
  );
  const piRow = document
    .querySelector('[aria-label="Uninstall Pi integration"]')!
    .closest("li")!;
  check(
    piRow.textContent!.includes("v9") && !piRow.textContent!.includes("v7"),
    "successful update did not refresh the installed version",
  );
  await waitFor(
    () =>
      button("Refresh integrations").getAttribute("aria-disabled") === "false",
  );
  click("Uninstall Claude Code integration");
  await waitFor(
    () =>
      !!document.querySelector(
        '[aria-label="Install Claude Code integration"]',
      ),
  );
  check(
    integrations.beta.find((item) => item.target === "claude")!.state ===
      "not_installed",
    "uninstall failed when the agent executable was absent",
  );
  await waitFor(
    () =>
      button("Refresh integrations").getAttribute("aria-disabled") === "false",
  );
  integrationSaveFailure = true;
  click("Uninstall Pi integration");
  await waitFor(() => !!document.querySelector('[role="alert"]'));
  check(
    document
      .querySelector('[role="alert"]')!
      .textContent!.includes("Configuration is not writable") &&
      !document
        .querySelector('[role="alert"]')!
        .textContent!.includes("update Herdr"),
    "integration mutation error was hidden or blamed Herdr's version",
  );
  integrationSaveFailure = false;
  const failedMutationCount = mutationCount();
  click("Refresh integrations");
  await waitFor(
    () => document.querySelectorAll(".agent-integrations-list li").length === 4,
  );
  check(
    mutationCount() === failedMutationCount,
    "refresh repeated a failed mutation",
  );
  integrationLoadFailure = true;
  click("Refresh integrations");
  await waitFor(() => !!document.querySelector('[role="alert"]'));
  check(
    document.querySelectorAll(".agent-integrations-list li").length === 0 &&
      document
        .querySelector('[role="alert"]')!
        .textContent!.includes("update Herdr"),
    "unsupported server retained actionable stale integrations",
  );
  integrationLoadFailure = false;
  malformedIntegrations = true;
  click("Refresh integrations");
  await waitFor(
    () =>
      !!document
        .querySelector('[role="alert"]')
        ?.textContent?.includes("Invalid integration list"),
  );
  malformedIntegrations = false;
  click("Refresh integrations");
  await waitFor(
    () => document.querySelectorAll(".agent-integrations-list li").length === 4,
  );

  const integrationLists = (id = active) =>
    calls.filter((call) => call.id === id && call.method === "integration.list")
      .length;
  let resolveIntegrations!: (value: unknown) => void;
  integrationRead = new Promise((resolve) => {
    resolveIntegrations = resolve;
  });
  const betaListsBeforeRefresh = integrationLists("beta");
  click("Refresh integrations");
  await waitFor(() => integrationLists("beta") === betaListsBeforeRefresh + 1);
  integrationRead = null;
  selectConnection("alpha");
  await waitFor(
    () => document.querySelectorAll(".agent-integrations-list li").length === 4,
  );
  resolveIntegrations({
    integrations: [{ ...integrations.beta[0], label: "Stale integration" }],
  });
  await settle();
  check(
    !dialog.textContent!.includes("Stale integration"),
    "late integration list crossed connections",
  );

  const antigravity = integrations.alpha.find(
    (item) => item.target === "antigravity_cli",
  )!;
  const successfulChange = Promise.withResolvers<unknown>();
  integrationChange = successfulChange.promise;
  const beforeTabRemount = mutationCount();
  click("Install Antigravity CLI integration");
  const listsBeforeTabRemount = integrationLists();
  backToList();
  await openPage("Integrations");
  await settle();
  check(
    button("Refresh integrations").getAttribute("aria-disabled") === "true" &&
      integrationLists() === listsBeforeTabRemount,
    "tab remount read stale status instead of awaiting its in-flight mutation",
  );
  flushSync(() =>
    document
      .querySelector<HTMLButtonElement>(
        '[aria-label="Install Antigravity CLI integration"]',
      )
      ?.click(),
  );
  check(
    mutationCount() === beforeTabRemount + 1,
    "tab remount allowed a duplicate mutation",
  );
  integrationChange = null;
  antigravity.state = "current";
  successfulChange.resolve({
    target: antigravity.target,
    details: { messages: ["Install completed after tab remount"] },
  });
  await waitFor(
    () =>
      button("Refresh integrations").getAttribute("aria-disabled") === "false",
  );
  check(
    !!document.querySelector(
      '[aria-label="Uninstall Antigravity CLI integration"]',
    ) &&
      dialog.textContent!.includes("Install completed after tab remount") &&
      integrationLists() === listsBeforeTabRemount + 1,
    "replacement tab failed to receive the completed mutation and fresh status",
  );

  const failedChange = Promise.withResolvers<unknown>();
  integrationChange = failedChange.promise;
  const beforeDialogRemount = mutationCount();
  click("Uninstall Antigravity CLI integration");
  const listsBeforeDialogRemount = integrationLists();
  closeSettings();
  await waitFor(() => !document.querySelector(".settings-home"));
  dialog = await openSettings();
  await openPage("Integrations");
  await settle();
  check(
    button("Refresh integrations").getAttribute("aria-disabled") === "true" &&
      integrationLists() === listsBeforeDialogRemount,
    "reopened Settings did not await its in-flight mutation",
  );
  flushSync(() =>
    document
      .querySelector<HTMLButtonElement>(
        '[aria-label="Uninstall Antigravity CLI integration"]',
      )
      ?.click(),
  );
  check(
    mutationCount() === beforeDialogRemount + 1,
    "dialog remount allowed a duplicate mutation",
  );
  integrationChange = null;
  failedChange.reject(new Error("Mutation failed after dialog remount"));
  await waitFor(
    () =>
      button("Refresh integrations").getAttribute("aria-disabled") === "false",
  );
  check(
    !!document.querySelector(
      '[aria-label="Uninstall Antigravity CLI integration"]',
    ) &&
      !!document
        .querySelector('[role="alert"]')
        ?.textContent?.includes("Mutation failed after dialog remount") &&
      integrationLists() === listsBeforeDialogRemount + 1,
    "reopened Settings lost the failed mutation or did not reload status",
  );
  click("Refresh integrations");
  await waitFor(
    () =>
      button("Refresh integrations").getAttribute("aria-disabled") === "false",
  );
  check(
    mutationCount() === beforeDialogRemount + 1 &&
      !document.querySelector('[role="alert"]'),
    "refresh repeated the failed mutation or retained its error",
  );
  click("Uninstall Antigravity CLI integration");
  await waitFor(
    () =>
      button("Refresh integrations").getAttribute("aria-disabled") === "false",
  );
  check(
    integrations.alpha.find((item) => item.target === "antigravity_cli")!
      .state === "not_installed",
    "failed operation left the connection locked",
  );

  const hiddenChange = Promise.withResolvers<unknown>();
  integrationChange = hiddenChange.promise;
  click("Install Antigravity CLI integration");
  backToList();
  integrationChange = null;
  antigravity.state = "current";
  hiddenChange.resolve({
    target: antigravity.target,
    details: { messages: ["Completed while unmounted"] },
  });
  await settle();
  await openPage("Integrations");
  await waitFor(
    () =>
      button("Refresh integrations").getAttribute("aria-disabled") === "false",
  );
  check(
    !!document.querySelector(
      '[aria-label="Uninstall Antigravity CLI integration"]',
    ) && dialog.textContent!.includes("Completed while unmounted"),
    "unmounted completion lost its outcome or left status stale",
  );
  click("Uninstall Antigravity CLI integration");
  await waitFor(
    () =>
      button("Refresh integrations").getAttribute("aria-disabled") === "false",
  );

  for (const closeDialog of [false, true]) {
    const hiddenFailure = Promise.withResolvers<unknown>();
    integrationChange = hiddenFailure.promise;
    click("Install Antigravity CLI integration");
    const writes = mutationCount();
    if (closeDialog) closeSettings();
    else backToList();
    integrationChange = null;
    hiddenFailure.reject(new Error("Mutation failed while unmounted"));
    await settle();
    if (closeDialog) {
      dialog = await openSettings();
    }
    // A failed status refresh must not discard the mutation failure either.
    integrationLoadFailure = closeDialog;
    await openPage("Integrations");
    await waitFor(
      () =>
        button("Refresh integrations").getAttribute("aria-disabled") ===
        "false",
    );
    check(
      !!document
        .querySelector('[role="alert"]')
        ?.textContent?.includes("Mutation failed while unmounted") &&
        mutationCount() === writes,
      "settled failure was lost when reopening integrations",
    );
    integrationLoadFailure = false;
    click("Refresh integrations");
    await waitFor(
      () =>
        button("Refresh integrations").getAttribute("aria-disabled") ===
        "false",
    );
    check(
      !document.querySelector('[role="alert"]') && mutationCount() === writes,
      "consumed failure was replayed or refresh repeated the mutation",
    );
  }

  let resolveChange!: (value: unknown) => void;
  integrationChange = new Promise((resolve) => {
    resolveChange = resolve;
  });
  const beforePending = mutationCount();
  click("Install Antigravity CLI integration");
  click("Install Antigravity CLI integration");
  check(
    mutationCount() === beforePending + 1,
    "duplicate integration mutation was sent",
  );
  const alphaLists = calls.filter(
    (call) => call.id === "alpha" && call.method === "integration.list",
  ).length;
  integrationChange = null;
  // Replace the runtime for the same connection ID while a write is in flight.
  selectConnection("alpha");
  await waitFor(
    () =>
      button("Refresh integrations").getAttribute("aria-disabled") === "false",
  );
  resolveChange({ messages: ["Stale mutation result"] });
  await settle();
  check(
    !dialog.textContent!.includes("Stale mutation result") &&
      calls.filter(
        (call) => call.id === "alpha" && call.method === "integration.list",
      ).length ===
        alphaLists + 1,
    "late mutation affected the replacement connection runtime",
  );
  const otherConnectionChange = Promise.withResolvers<unknown>();
  integrationChange = otherConnectionChange.promise;
  click("Install Antigravity CLI integration");
  const beforeConnectionSwitch = mutationCount();
  integrationChange = null;
  selectConnection("beta");
  await waitFor(
    () =>
      button("Refresh integrations").getAttribute("aria-disabled") === "false",
  );
  click("Uninstall Pi integration");
  await waitFor(
    () =>
      button("Refresh integrations").getAttribute("aria-disabled") === "false",
  );
  check(
    mutationCount() === beforeConnectionSwitch + 1,
    "another connection's pending mutation blocked the selected connection",
  );
  otherConnectionChange.resolve({
    target: "antigravity_cli",
    details: { messages: ["Retired alpha operation"] },
  });
  await settle();
  check(
    !dialog.textContent!.includes("Retired alpha operation"),
    "retired connection operation leaked into the current view",
  );
  check(
    dialog.scrollWidth <= dialog.clientWidth + 1,
    "integration messages overflow the viewport",
  );

  // Restart World with Integrations open: the socket drops and returns before
  // World's catalog restores the runtime lease, then the catalog arrives.
  selectConnection("alpha");
  await waitFor(
    () => document.querySelectorAll(".agent-integrations-list li").length === 4,
  );
  const restartLists = integrationLists("alpha");
  const restartWorldLists = worldIntegrationLists;
  const restart = (status: "disconnected" | "connected", ready: boolean) =>
    flushSync(() =>
      __storeTesting.replaceState({
        ...store.get(),
        status,
        catalogueReady: ready,
      }),
    );
  runtimeLeaseReady = false;
  restart("disconnected", false);
  restart("connected", false);
  await settle();
  check(
    !document.querySelector('[role="alert"]') &&
      !!document
        .querySelector('[role="status"].agent-integrations-status')
        ?.textContent?.includes("Reconnecting to World"),
    "a World restart showed an error instead of reconnecting",
  );
  runtimeLeaseReady = true;
  restart("connected", true);
  await waitFor(
    () =>
      document.querySelectorAll(".agent-integrations-list li").length === 4 &&
      button("Refresh integrations").getAttribute("aria-disabled") === "false",
  );
  check(
    !document.querySelector('[role="alert"]') &&
      integrationLists("alpha") > restartLists &&
      worldIntegrationLists > restartWorldLists,
    "integrations did not reload by themselves after a World restart",
  );
  // A lease that never returns offers a plain Reload, never a host or Herdr fix.
  runtimeLeaseReady = false;
  restart("disconnected", false);
  restart("connected", true);
  await waitFor(() => !!document.querySelector('[role="alert"]'));
  const stale = document.querySelector('[role="alert"]')!;
  check(
    !!stale.querySelector("button")?.textContent?.includes("Reload") &&
      !/Reconnect it|update Herdr/.test(stale.textContent!),
    "a stale client did not offer a plain Reload",
  );
  runtimeLeaseReady = true;
  selectConnection("alpha");
  await waitFor(
    () =>
      document.querySelectorAll(".agent-integrations-list li").length === 4 &&
      !document.querySelector('[role="alert"]'),
  );
  // Escape leaves a page for the list, then closes Settings.
  await key(button("Refresh integrations"), "Escape");
  await settle();
  check(
    !document.querySelector(".settings-page") &&
      document.activeElement === button("Open Integrations"),
    "Escape did not return from the page to its row",
  );
  await key(document.activeElement!, "Escape");
  await settle();
  check(
    !document.querySelector(".settings-home") &&
      document.activeElement === button("Menu"),
    "Escape did not close and restore focus",
  );
  // Open Settings from a World view: with nothing selected, and with a
  // selection on another host at a runtime generation that is not current.
  // Integrations still loads the active connection it names.
  for (const context of [
    { connectionId: "", runtimeGeneration: -1 },
    { connectionId: "beta", runtimeGeneration: 99 },
  ]) {
    worldViewContext = context;
    flushSync(render);
    const before = integrationLists("alpha");
    await openSettings();
    await openPage("Integrations");
    await waitFor(
      () =>
        document.querySelectorAll(".agent-integrations-list li").length === 4 &&
        button("Refresh integrations").getAttribute("aria-disabled") ===
          "false",
    );
    check(
      !document.querySelector('[role="alert"]') &&
        !/Waiting for Herdr|Reconnecting/.test(
          document.querySelector(".agent-integrations-settings")!.textContent!,
        ) &&
        integrationLists("alpha") === before + 1 &&
        document
          .querySelector(".agent-integrations-settings")!
          .textContent!.includes("Local test"),
      `Integrations opened from a World view (${JSON.stringify(context)}) did not load the active connection`,
    );
    closeSettings();
    await waitFor(() => !document.querySelector(".settings-home"));
  }
  worldViewContext = null;
  flushSync(render);
  // Help is a category of Settings; its rows open their pages in a new tab.
  const originalOpen = window.open;
  const openedLinks: Array<
    [string | URL | undefined, string | undefined, string | undefined]
  > = [];
  window.open = (url, target, features) => {
    openedLinks.push([url, target, features]);
    return null;
  };
  try {
    for (const [label, url] of [
      ["Tutorial", "https://herdr.world/tutorial/"],
      ["Features and shortcuts", "https://herdr.world/features/"],
      [
        "Troubleshooting",
        "https://github.com/IvoryHeart/herdr-world/blob/main/docs/DEPLOYMENT.md#troubleshooting",
      ],
      ["Report an issue", "https://github.com/IvoryHeart/herdr-world/issues"],
    ]) {
      click("Menu");
      click("Help");
      await waitFor(() => !!document.querySelector(".settings-home"));
      check(
        tab("Help").getAttribute("aria-selected") === "true",
        "Help did not open Settings at Help",
      );
      click(label!);
      check(
        !document.querySelector(".settings-home"),
        `${label} left Settings open`,
      );
      check(
        JSON.stringify(openedLinks[openedLinks.length - 1]) ===
          JSON.stringify([url, "_blank", "noopener,noreferrer"]),
        `${label} opened an incorrect or unsafe destination`,
      );
    }
  } finally {
    window.open = originalOpen;
  }
  if (mobile) {
    for (const reducedMotion of [false, true]) {
      await input("Emulation.setEmulatedMedia", {
        features: [
          {
            name: "prefers-reduced-motion",
            value: reducedMotion ? "reduce" : "no-preference",
          },
        ],
      });
      const drawer = await openSettings();
      await Promise.all(
        drawer.getAnimations().map((animation) => animation.finished),
      );
      const top = drawer.getBoundingClientRect().top;
      check(
        getComputedStyle(drawer).transitionDuration ===
          (reducedMotion ? "0s" : "0.2s"),
        "drawer did not honor motion preference",
      );
      const surface = reducedMotion
        ? button("Dismiss Settings")
        : drawer.querySelector(".configuration-content")!;
      await swipe(surface, 0, 60, true);
      check(
        drawer.isConnected &&
          Math.abs(drawer.getBoundingClientRect().top - top) < 1,
        "cancelled swipe did not restore Settings position",
      );
      const frames = await swipe(surface, 0, 60);
      check(
        Math.abs(frames[frames.length - 1].top - top - 60) < 2,
        "scaled Settings did not follow the finger",
      );
      // Settings returns focus to Menu on the frame after it closes.
      await waitFor(() => !document.querySelector(".settings-home"));
      await settle();
      check(
        document.activeElement === button("Menu"),
        "drawer dismissal did not restore Menu focus",
      );
    }
  }
  root.unmount();
}
run()
  .catch((error) => failures.push(String(error?.stack ?? error)))
  .finally(() =>
    fetchResult("/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(failures),
    }),
  );
