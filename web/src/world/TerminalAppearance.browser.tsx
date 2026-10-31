import { useSpacesTabWindowArrangement } from "./useSpacesTabWindowArrangement";
import {
  initializeLayoutPreferences,
  updateLayoutPreferences,
  useLayoutPreferences,
} from "../layoutPreferences";
import {
  MobileTerminalAppBar,
  MobileTerminalIdentity,
  usePublishMobileControls,
} from "../components/MobileControls";
import { useStoreSelector } from "../store";
import { TabBar } from "../components/TabBar";
import { __storeTesting, store as runtimeStore } from "../store";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { bridge, type BridgeControlMsg } from "../api";
import { sharedBoardStore, useBoardDocument } from "./board/boardDocument";
import { WorkspaceInspectorAgentIdentity } from "../components/WorkspaceInspectorAgentIdentity";
import { TerminalAppearanceEditor } from "./TerminalAppearanceEditor";
import { TerminalAppearanceButton } from "./TerminalAppearanceButton";
import { AppearanceAvatar } from "./AppearanceAvatar";
import { appearanceFor } from "../../../shared/appearance";
import { TERMINAL_COLOR_PALETTE } from "./terminalColor";
import "../styles/tokens.css";
import "../styles/base.css";
import "../components/WorkspaceInspectorFrame.css";
import "../components/WorkspaceInspectorHost.css";

const adapterMode = new URLSearchParams(location.search).has("adapters");
if (adapterMode) initializeLayoutPreferences();
const controls = new Set<(event: BridgeControlMsg) => void>();
bridge.onControl = (fn) => {
  controls.add(fn);
  return () => {
    controls.delete(fn);
  };
};
bridge.onStatus = () => () => {};
bridge.call = (async (method: string, params?: Record<string, unknown>) => {
  const response = await fetch("/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(body.error);
  return body.result;
}) as typeof bridge.call;
const stream = new EventSource("/events");
stream.onmessage = (event) => {
  for (const listener of controls) listener(JSON.parse(event.data));
  window.dispatchEvent(new Event("native-change"));
};
function acceptNative(label: string, destination = false, moved = false) {
  __storeTesting.replaceState({
    ...runtimeStore.get(),
    status: "connected",
    catalogueReady: true,
    activeConnectionId: "alpha",
    serverRuntimeGeneration: 3,
    selectedPaneId: adapterMode ? "pane-2" : runtimeStore.get().selectedPaneId,
    connections: [
      {
        id: "alpha",
        generation: 3,
        state: "ready",
        label: "Example connection",
        type: "local",
        source: "synthetic",
        is_default: true,
      },
    ],
    workspaces: [
      {
        workspace_id: "space-1",
        label: "Example workspace",
        number: 1,
        focused: true,
        pane_count: 2,
        tab_count: destination ? 2 : 1,
        active_tab_id: moved ? "tab-2" : "tab-1",
        agent_status: "working",
      },
    ],
    tabs: [
      {
        tab_id: "tab-1",
        workspace_id: "space-1",
        label,
        number: 1,
        focused: !moved,
        pane_count: moved ? 1 : 2,
        agent_status: "working",
      },
      ...(destination
        ? [
            {
              tab_id: "tab-2",
              workspace_id: "space-1",
              label: "Destination",
              number: 2,
              focused: moved,
              pane_count: moved ? 2 : 1,
              agent_status: "working",
            },
          ]
        : []),
    ],
    panes: (destination ? [1, 2, 3] : [1, 2]).map((number) => ({
      pane_id: `pane-${number}`,
      terminal_id: `terminal-${number}`,
      tab_id: number === 3 || (moved && number === 2) ? "tab-2" : "tab-1",
      workspace_id: "space-1",
      focused: number === (adapterMode ? 2 : 1),
      agent: "codex",
      agent_status: "working",
      revision: 1,
    })),
  });
}
acceptNative("Analysis");
function App() {
  const store = sharedBoardStore(),
    { document } = useBoardDocument(store);
  const [label, setLabel] = useState("Analysis");
  useEffect(() => {
    store.start();
    const refresh = () =>
      void fetch("/native")
        .then((response) => response.json())
        .then((native) => {
          acceptNative(native.label, native.destination, native.moved);
          setLabel(native.label);
        });
    refresh();
    window.addEventListener("native-change", refresh);
    return () => {
      store.stop();
      window.removeEventListener("native-change", refresh);
    };
  }, [store]);
  const color = {
    palette: TERMINAL_COLOR_PALETTE,
    current: {
      id: document?.layout.colors?.["alpha:tab-1"] ?? "blue",
      custom: Boolean(document?.layout.colors?.["alpha:tab-1"]),
    },
    onColor: () => {},
  };
  const status = appearanceFor(document?.appearance, {
    connection_id: "alpha",
    kind: "tab",
    native_id: "tab-1",
    witness: ["terminal-1", "terminal-2"],
  })?.status;
  if (adapterMode) return <AdapterApp color={color} />;
  return (
    <main style={{ padding: 12, maxWidth: 700 }}>
      <TabBar
        tabColors={{
          palette: color.palette,
          colorOf: () => color.current,
          onColor: () => {},
        }}
      />
      <h1>Terminal appearance</h1>
      <p>
        Native tab: <span data-native-name>{label}</span>
      </p>
      {status ? <p data-tab-status>{status}</p> : null}
      {[1, 2].map((number) => {
        const target = {
          connectionId: "alpha",
          generation: 3,
          tabId: "tab-1",
          paneId: `pane-${number}`,
          terminalId: `terminal-${number}`,
          tabTerminals: ["terminal-1", "terminal-2"],
          workspaceIds: ["space-1"],
          tabName: label,
          color,
        };
        const avatar = appearanceFor(document?.appearance, {
          connection_id: "alpha",
          kind: "pane",
          native_id: `pane-${number}`,
          witness: [`terminal-${number}`],
        })?.avatar;
        return (
          <section
            key={number}
            data-pane={number}
            style={{ marginBottom: 16, padding: 8, border: "1px solid #555" }}
          >
            <h2>Pane {number}</h2>
            <WorkspaceInspectorAgentIdentity
              context={{
                kind: "agent",
                label: "Agent",
                tabName: label,
                agent: "codex",
                stateLabel: "Working",
                statusTone: "working",
                locationLabel: "Workspace",
                appearanceAvatar: avatar,
              }}
              terminalColor={color}
              location={<span>Example workspace</span>}
              agentSettings={<TerminalAppearanceEditor {...target} />}
            />
            <div style={{ marginTop: 12 }}>
              <TerminalAppearanceButton {...target} />
            </div>
            <AppearanceAvatar id={avatar} />
          </section>
        );
      })}
    </main>
  );
}
function AdapterApp({
  color,
}: {
  color: Parameters<typeof TerminalAppearanceEditor>[0]["color"];
}) {
  const arrangement = useSpacesTabWindowArrangement(true),
    { mobile } = useLayoutPreferences();
  useEffect(() => {
    if (!mobile && !arrangement.arrangementControl.disabledReasons.columns)
      arrangement.arrangementControl.onSelect("columns");
  }, [mobile, arrangement.arrangementControl.disabledReasons.columns]);
  return (
    <main>
      {mobile ? (
        <MobileAdapter color={color} />
      ) : (
        <>
          <div data-adapter-native-tabs>
            <TabBar
              tabColors={{
                palette: color.palette,
                colorOf: () => color.current,
                onColor: () => {},
              }}
            />
          </div>
          <div
            className="workspace-stage"
            style={{ position: "relative", width: "100%", height: "100vh" }}
          >
            <div
              ref={arrangement.onSpacesWindowLayerReady}
              className="spaces-window-layer"
              style={{ position: "absolute", inset: 0 }}
            />
            {arrangement.renderWindows}
          </div>
        </>
      )}
    </main>
  );
}
function MobileAdapter({
  color,
}: {
  color: Parameters<typeof TerminalAppearanceEditor>[0]["color"];
}) {
  const pane = useStoreSelector((state) =>
    state.panes.find((pane) => pane.pane_id === "pane-2"),
  );
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  usePublishMobileControls({
    tabCount: 2,
    attention: false,
    tabsDisabled: false,
    tabsOpen: false,
    showTabs: () => {},
    moreOpen: false,
    toggleMore: () => {},
    workspacesOpen: false,
    toggleWorkspaces: () => {},
    tabColors: {
      palette: color.palette,
      colorOf: () => color.current,
      onColor: () => {},
    },
  });
  return (
    <>
      <MobileTerminalAppBar />
      <div ref={setElement} style={{ height: 500, width: "100%" }}>
        Synthetic terminal viewport
      </div>
      <MobileTerminalIdentity pane={pane} active element={element} />
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
const failures: string[] = [];
function check(value: unknown, message: string) {
  if (!value) failures.push(message);
}
function waitFor<T>(
  read: () => T,
  message: string,
  timeout = 12000,
): Promise<NonNullable<T>> {
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(test);
    function test() {
      const value = read();
      if (value) {
        clearTimeout(timer);
        observer.disconnect();
        resolve(value as NonNullable<T>);
      }
    }
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(message));
    }, timeout);
    test();
  });
}
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === text,
  );
async function open(pane: number, mobile = false) {
  document
    .querySelector<HTMLButtonElement>(
      `[data-pane="${pane}"] ${mobile ? ".mobile-appearance-button" : ".workspace-inspector-agent-avatar"}`,
    )!
    .click();
  return waitFor(
    () => document.querySelector<HTMLElement>(".terminal-appearance-editor"),
    "editor did not open",
  );
}
function input(label: string, text: string) {
  const node = document.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  )!;
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!.call(node, text);
  node.dispatchEvent(new Event("input", { bubbles: true }));
}
async function click(label: string) {
  const node = await waitFor(
    () =>
      document.querySelector<HTMLButtonElement>(
        `button[aria-label="${label}"]`,
      ),
    `missing ${label}`,
  );
  node.click();
}
async function saved(text: string) {
  await waitFor(
    () =>
      [...document.querySelectorAll("[role=status]")].find(
        (node) => node.textContent === text,
      ),
    `missing confirmation ${text}`,
  );
}
function close() {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
}
async function runAdapters() {
  const nativeOpener = await waitFor(
    () =>
      document.querySelector<HTMLButtonElement>(
        '[data-adapter-native-tabs] [data-tab-id="tab-1"] .mobile-appearance-button',
      ),
    "native Spaces tab-strip editor missing",
  );
  nativeOpener.click();
  await waitFor(
    () => document.querySelector(".terminal-appearance-editor"),
    "native tab-strip editor did not mount",
  );
  input("Tab status message", "Native Spaces status");
  await waitFor(
    () => button("Save status") && !button("Save status")!.disabled,
    "native tab status draft",
  );
  button("Save status")!.click();
  await saved("Tab status saved");
  close();
  await waitFor(
    () =>
      document.querySelector(".spaces-tab-window .mobile-appearance-button"),
    "desktop Spaces common appearance opener missing",
  );
  document
    .querySelector<HTMLButtonElement>(
      '.spaces-tab-window[data-world-window-id="tab-1"] .mobile-appearance-button, .spaces-tab-window[data-tab-id="tab-1"] .mobile-appearance-button, .spaces-tab-window .mobile-appearance-button',
    )!
    .click();
  await waitFor(
    () => document.querySelector(".terminal-appearance-editor"),
    "desktop Spaces editor did not mount",
  );
  input("Tab status message", "Desktop Spaces status");
  await waitFor(
    () => button("Save status") && !button("Save status")!.disabled,
    "desktop status draft",
  );
  button("Save status")!.click();
  await saved("Tab status saved");
  await click("Avatar Builder");
  await saved("Pane avatar saved");
  input("Tab name", "Desktop native tab");
  await waitFor(
    () => button("Save name") && !button("Save name")!.disabled,
    "desktop rename draft",
  );
  button("Save name")!.click();
  await saved("Native tab name saved");
  close();
  let calls = await fetch("/inspection").then((reply) => reply.json());
  check(
    calls.some(
      (call: {
        method: string;
        params: {
          native_id: string;
          connection_id: string;
          connection_generation: number;
          fields?: { status: string };
        };
      }) =>
        call.method === "world.appearance.patch" &&
        call.params.native_id === "tab-1" &&
        call.params.connection_id === "alpha" &&
        call.params.connection_generation === 3 &&
        call.params.fields?.status === "Native Spaces status",
    ),
    "native tab-strip save lost its qualified tab owner",
  );
  check(
    calls.some(
      (call: {
        method: string;
        params: {
          native_id: string;
          connection_id: string;
          connection_generation: number;
          fields?: { status: string };
        };
      }) =>
        call.method === "world.appearance.patch" &&
        call.params.native_id === "tab-1" &&
        call.params.connection_id === "alpha" &&
        call.params.connection_generation === 3 &&
        call.params.fields?.status === "Desktop Spaces status",
    ),
    "desktop status lost its qualified tab owner",
  );
  check(
    calls.some(
      (call: {
        method: string;
        params: {
          native_id: string;
          kind: string;
          connection_id: string;
          connection_generation: number;
          fields?: { avatar: string };
        };
      }) =>
        call.method === "world.appearance.patch" &&
        call.params.kind === "pane" &&
        call.params.native_id === "pane-2" &&
        call.params.connection_id === "alpha" &&
        call.params.connection_generation === 3 &&
        call.params.fields?.avatar === "builder",
    ),
    "desktop avatar did not target the selected pane",
  );
  await fetch("/adapter-mobile", { method: "POST" });
  updateLayoutPreferences({ mode: "mobile" });
  const opener = await waitFor(
    () =>
      document.querySelector<HTMLButtonElement>(
        ".mobile-terminal-appbar .mobile-appearance-button",
      ),
    "real phone appearance opener missing",
  );
  opener.click();
  await waitFor(
    () => document.querySelector(".terminal-appearance-editor"),
    "phone editor missing",
  );
  input("Tab name", "Source tab name draft");
  input("Tab status message", "Source tab status draft");
  await waitFor(
    () => button("Save status") && !button("Save status")!.disabled,
    "phone source draft missing",
  );
  await fetch("/move-pane", { method: "POST" });
  await waitFor(
    () =>
      document
        .querySelector(".mobile-terminal-name")
        ?.textContent?.includes("Destination"),
    "phone publisher did not retarget the moved pane",
  );
  const stale = document.querySelector(".terminal-appearance-editor");
  check(
    !stale,
    "phone editor retained a dirty source-tab draft after moving panes",
  );
  if (stale) {
    button("Save status")!.click();
    await saved("Tab status saved");
    close();
  }
  document
    .querySelector<HTMLButtonElement>(
      ".mobile-terminal-appbar .mobile-appearance-button",
    )!
    .click();
  await waitFor(
    () => document.querySelector(".terminal-appearance-editor"),
    "destination editor missing",
  );
  check(
    document.querySelector<HTMLInputElement>('input[aria-label="Tab name"]')
      ?.value === "Destination",
    "source name draft crossed into destination tab",
  );
  check(
    document.querySelector<HTMLInputElement>(
      'input[aria-label="Tab status message"]',
    )?.value === "Destination status",
    "source status draft crossed into destination tab",
  );
  input("Tab status message", "Destination status updated");
  await waitFor(
    () => button("Save status") && !button("Save status")!.disabled,
    "destination draft missing",
  );
  button("Save status")!.click();
  await saved("Tab status saved");
  calls = await fetch("/inspection").then((reply) => reply.json());
  check(
    !calls.some(
      (call: { params: { fields?: { status: string }; label?: string } }) =>
        call.params.fields?.status === "Source tab status draft" ||
        call.params.label === "Source tab name draft",
    ),
    "phone editor saved a source-tab draft against its destination",
  );
  check(
    calls.some(
      (call: {
        params: {
          native_id: string;
          connection_id: string;
          connection_generation: number;
          fields?: { status: string };
        };
      }) =>
        call.params.native_id === "tab-2" &&
        call.params.connection_id === "alpha" &&
        call.params.connection_generation === 3 &&
        call.params.fields?.status === "Destination status updated",
    ),
    "destination save was not qualified to its actual tab",
  );
  return failures;
}
async function run() {
  await waitFor(
    () => document.querySelector("[data-pane]"),
    "fixture did not mount",
  );
  const receiver = new URLSearchParams(location.search).has("receiver");
  if (receiver) {
    await waitFor(
      () =>
        document.querySelector("[data-tab-status]")?.textContent ===
          "Ready for review" &&
        document.querySelector("[data-native-name]")?.textContent ===
          "Shared native tab" &&
        document.querySelector(
          '[data-pane="1"] [data-appearance-avatar="builder"]',
        ),
      "second browser did not receive shared appearance",
    );
    check(
      document.querySelector<HTMLElement>('[data-tab-id="tab-1"]')?.title ===
        "Shared native tab · Ready for review",
      "Spaces tooltip did not show the native name and shared status",
    );
    check(
      document.querySelector(
        '[data-tab-id="tab-1"] [data-appearance-avatar="builder"]',
      ),
      "Spaces did not use the selected pane avatar",
    );
    await open(2, true);
    await click("Avatar Designer");
    await saved("Pane avatar saved");
    close();
    await waitFor(
      () =>
        !document.querySelector(
          '[data-pane="1"] [data-appearance-avatar="builder"]',
        ) && !document.querySelector("[data-tab-status]"),
      "second browser did not receive independent reset",
    );
    check(
      document.querySelector(
        '[data-pane="2"] [data-appearance-avatar="designer"]',
      ),
      "pane two avatar was erased by pane one's reset",
    );
  } else {
    await open(1);
    await click("Colour pink");
    await saved("Tab colour saved");
    input("Tab status message", "Ready for review");
    await waitFor(
      () => button("Save status") && !button("Save status")!.disabled,
      "status input did not become dirty",
    );
    button("Save status")!.click();
    await saved("Tab status saved");
    await click("Avatar Builder");
    await saved("Pane avatar saved");
    input("Tab name", "Shared native tab");
    await waitFor(
      () => button("Save name") && !button("Save name")!.disabled,
      "name input did not become dirty",
    );
    button("Save name")!.click();
    await saved("Native tab name saved");
    await waitFor(
      () =>
        document.querySelector("[data-native-name]")?.textContent ===
        "Shared native tab",
      "successful native rename was not observed",
    );
    await fetch("/fail-next-name", { method: "POST" });
    input("Tab name", "Rejected name");
    await waitFor(
      () => button("Save name") && !button("Save name")!.disabled,
      "failed-name input did not become dirty",
    );
    button("Save name")!.click();
    await waitFor(
      () => document.querySelector('[role="alert"]'),
      "native failure was not visible",
    );
    check(
      document.querySelector<HTMLInputElement>('input[aria-label="Tab name"]')
        ?.value === "Rejected name",
      "failure discarded native rename draft",
    );
    check(
      document.querySelector("[data-native-name]")?.textContent ===
        "Shared native tab",
      "native failure created a shadow name",
    );
    const nativeAfterFailure = (await fetch("/native").then((reply) =>
      reply.json(),
    )) as { label: string };
    check(
      nativeAfterFailure.label === "Shared native tab",
      "failed rename changed the authoritative native name",
    );
    close();
    await waitFor(
      () =>
        document.querySelector(
          '[data-pane="2"] [data-appearance-avatar="designer"]',
        ),
      "first browser did not receive pane two avatar",
    );
    await open(1);
    button("Default avatar")!.click();
    await saved("Pane avatar reset");
    button("Clear status")!.click();
    await saved("Tab status reset");
    close();
    check(
      document.querySelector(
        '[data-pane="2"] [data-appearance-avatar="designer"]',
      ),
      "independent pane avatar was reset",
    );
  }
  check(
    document.documentElement.scrollWidth <= innerWidth,
    "appearance controls overflow the viewport",
  );
  return failures;
}
if (!new URLSearchParams(location.search).has("capture"))
  void (adapterMode ? runAdapters() : run())
    .then((failures) =>
      fetch("/result", {
        method: "POST",
        body: JSON.stringify({
          adapters: adapterMode,
          receiver: new URLSearchParams(location.search).has("receiver"),
          failures,
        }),
      }),
    )
    .catch((error) =>
      fetch("/result", {
        method: "POST",
        body: JSON.stringify({
          adapters: adapterMode,
          receiver: new URLSearchParams(location.search).has("receiver"),
          failures: [String(error)],
        }),
      }),
    );
