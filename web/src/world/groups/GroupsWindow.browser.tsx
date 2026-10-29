import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { bridge } from "../../api";
import {
  AgentInterestButton,
  useAgentInterestChoice,
} from "../../components/AgentInterestButton";
import { WindowControls } from "../windows/WindowControls";
import {
  WorldPanelsContext,
  useWorldPanelRegistry,
  useWorldPanelFocus,
  WorldPanelWindow,
} from "../windows/WorldPanel";
import { WindowFrame } from "../windows/WindowFrame";
import { WindowSurface } from "../windows/WindowSurface";
import { useWindowManager } from "../windows/useWindowManager";
import { buildWorldObject, type WorldObject } from "../worldObject";
import { parseWorldSnapshotResult, worldRuntimeStore } from "../runtimeStore";
import { GroupsWindow } from "./GroupsWindow";
import { GroupsSummary } from "./GroupsSummary";
import { TownSummaryPanel } from "../town/TownSummaryPanel";
import "../../styles/tokens.css";
import "../../styles/base.css";
import "../../components/WorkspaceAgentRows.css";
import "../world.css";

Object.assign(bridge, {
  call: async (method: string, params?: unknown) => {
    const value = await (
      await fetch("/rpc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method, params }),
      })
    ).json();
    if (value?.error) throw new Error(value.error);
    return value;
  },
  connection: () => ({ isCurrent: () => true }),
  onControl: () => () => {},
  onStatus: () => () => {},
});
// Cover the plain-HTTP LAN path where randomUUID is unavailable.
Object.defineProperty(Crypto.prototype, "randomUUID", {
  value: undefined,
  configurable: true,
});

function Fixture({ world }: { world: WorldObject }) {
  const registry = useWorldPanelRegistry();
  const stage = { width: innerWidth, height: innerHeight };
  const { state, dispatch } = useWindowManager(
    registry.panels.map(({ id, label }) => ({ id, label })),
    stage,
  );
  const [inspected, setInspected] = useState("");
  const [summaryOpen, setSummaryOpen] = useState(false);
  useWorldPanelFocus(registry, state, dispatch);
  const compact = innerWidth < 700;
  const attention = useAgentInterestChoice(
    "connection-a",
    world.leaves[0]?.pane,
  );
  return (
    <WorldPanelsContext.Provider value={registry}>
      <p data-inspected={inspected}>Example crew</p>
      <button type="button" onClick={() => setSummaryOpen(!summaryOpen)}>
        {summaryOpen ? "Close Summary" : "Summary"}
      </button>
      <button
        type="button"
        onClick={() => dispatch({ type: "minimize", id: "panel:groups" })}
      >
        Minimize Groups
      </button>
      {summaryOpen && (
        <TownSummaryPanel
          summary={{
            counts: { needsYou: 0, working: 0, finished: 0 },
            needsYou: [],
            asks: [],
            finished: [],
            hosts: [],
            spend: { available: false },
          }}
          now={1}
          onOpenAgent={() => {}}
          onShowRoom={() => {}}
          askActions={{
            askers: new Map(),
            answer: async () => null,
            dismiss: async () => null,
            open() {},
          }}
          groups={<GroupsSummary />}
        />
      )}
      <AgentInterestButton
        connectionId="connection-a"
        pane={world.leaves[0]?.pane}
      />
      <WindowControls
        label="fixture agent"
        controls={{
          compact: true,
          maximized: false,
          attention,
          onClose() {},
          onMinimize() {},
          onMaximize() {},
          onSnap() {},
          onFloat() {},
        }}
      />
      <GroupsWindow world={world} onOpenTerminal={setInspected} />
      <WindowSurface
        state={state}
        dispatch={dispatch}
        stage={stage}
        compact={compact}
        onLayer={() => {}}
      >
        {({ entry, geometry, stage, workArea, zIndex, active }) => {
          const panel = registry.panels.find((panel) => panel.id === entry.id);
          return panel ? (
            <WindowFrame
              key={entry.id}
              id={entry.id}
              label={`${panel.label} window`}
              geometry={geometry}
              stage={stage}
              workArea={workArea}
              zIndex={zIndex}
              active={active}
              compact={compact}
              onRaise={() => dispatch({ type: "raise", id: entry.id })}
              onPlace={(rect) =>
                dispatch({ type: "place", id: entry.id, rect })
              }
              onSnap={(target) =>
                dispatch({ type: "snap", id: entry.id, target })
              }
              onMaximize={() => dispatch({ type: "maximize", id: entry.id })}
            >
              <WorldPanelWindow
                label={panel.label}
                onBody={registry.panelBodyRef(entry.id)}
                controls={{
                  compact,
                  maximized: entry.maximized,
                  onMinimize: () =>
                    dispatch({ type: "minimize", id: entry.id }),
                  onMaximize: () =>
                    dispatch({ type: "maximize", id: entry.id }),
                  onClose: panel.onClose,
                  onSnap: (target) =>
                    dispatch({ type: "snap", id: entry.id, target }),
                  onFloat: () => dispatch({ type: "float", id: entry.id }),
                  back: { label: "Back to Town" },
                }}
              />
            </WindowFrame>
          ) : null;
        }}
      </WindowSurface>
    </WorldPanelsContext.Provider>
  );
}
const failures: string[] = [];
const params = new URL(location.href).searchParams;
const check = (condition: unknown, message: string) => {
  if (!condition) failures.push(message);
};
const waitFor = (condition: () => unknown) =>
  new Promise<void>((resolve, reject) => {
    if (condition()) {
      resolve();
      return;
    }
    const observer = new MutationObserver(() => {
      if (condition()) {
        observer.disconnect();
        clearTimeout(timer);
        resolve();
      }
    });
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(
        new Error(
          `Groups UI did not reach expected state: ${document.querySelector(".groups-window")?.textContent?.slice(0, 1200) ?? "panel absent"}`,
        ),
      );
    }, 10_000);
    observer.observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
  });
const buttons = () => [
  ...document.querySelectorAll<HTMLButtonElement>("button"),
];
const click = (text: string) => {
  const button = buttons().find(
    (button) => button.textContent?.trim().replace(/^←\s*/, "") === text,
  );
  if (!button) throw new Error(`missing button ${text}`);
  button.click();
};
async function run() {
  if (params.has("width"))
    check(
      innerWidth === Number(params.get("width")),
      `Expected ${params.get("width")} CSS px, got ${innerWidth}`,
    );
  if (params.has("height"))
    check(
      innerHeight === Number(params.get("height")),
      `Expected ${params.get("height")} CSS px height, got ${innerHeight}`,
    );
  const payload = await (await fetch("/snapshot")).json();
  const observed = parseWorldSnapshotResult(payload)!;
  const world = buildWorldObject(observed.connections);
  worldRuntimeStore.start();
  await worldRuntimeStore.refresh();
  if (worldRuntimeStore.get().status !== "ready")
    throw new Error(`Fixture runtime: ${worldRuntimeStore.get().error}`);
  if (worldRuntimeStore.get().connections.length !== 1)
    throw new Error("Fixture must admit one current connection");
  const root = createRoot(document.getElementById("root")!);
  flushSync(() => root.render(<Fixture world={world} />));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  click("Summary");
  await waitFor(() => document.querySelector(".groups-summary-pod"));
  document.querySelector<HTMLButtonElement>(".groups-summary-pod")!.click();
  await waitFor(() => document.querySelector(".group-detail"));
  const detail = document.querySelector<HTMLElement>(".groups-window")!;
  check(
    detail.scrollWidth <= detail.clientWidth,
    "Group detail fits without horizontal scrolling",
  );
  check(
    Boolean(
      document
        .querySelector(".world-panel-title")
        ?.textContent?.includes("Pod · Chat"),
    ),
    "Summary must open the current Pod through the shared Groups event",
  );
  click("Close Summary");
  click("Back to Groups");
  await waitFor(
    () => document.querySelectorAll(".group-roster-row").length > 3,
  );
  check(
    Boolean(document.querySelector(".world-managed-window .groups-window")),
    "Groups must portal into the existing managed panel",
  );
  check(
    document.documentElement.scrollWidth <= innerWidth,
    "Groups roster must fit the viewport",
  );
  click("Minimize Groups");
  await waitFor(
    () => !document.querySelector(".world-managed-window .groups-window"),
  );
  click("Summary");
  await waitFor(() => document.querySelector(".groups-summary-pod"));
  document.querySelector<HTMLButtonElement>(".groups-summary-pod")!.click();
  await waitFor(() =>
    document.querySelector(".world-managed-window .group-detail"),
  );
  check(
    Boolean(
      document
        .querySelector(".world-panel-title")
        ?.textContent?.includes("Pod · Chat"),
    ),
    "Summary must restore the minimized Groups detail",
  );
  click("Close Summary");
  click("Back to Groups");
  await waitFor(
    () => document.querySelectorAll(".group-roster-row").length > 3,
  );
  if (new URL(location.href).searchParams.has("preview")) {
    if (new URL(location.href).searchParams.has("detail")) {
      buttons()
        .find(
          (button) =>
            button.classList.contains("group-roster-row") &&
            button.textContent?.includes("Pod · Chat"),
        )!
        .click();
      await waitFor(() => document.querySelector(".group-detail"));
    }
    document.body.dataset.ready = "true";
    return;
  }
  click("Pod");
  await waitFor(
    () => document.querySelectorAll(".group-roster-row").length === 2,
  );
  buttons()
    .find(
      (button) =>
        button.classList.contains("group-roster-row") &&
        button.textContent?.includes("Pod · Chat"),
    )!
    .click();
  await waitFor(() => document.querySelector(".group-detail"));
  check(
    document
      .querySelector(".group-detail")
      ?.textContent?.includes("Away · last seen unavailable"),
    "away membership must not invent a last seen time",
  );
  check(
    document
      .querySelector(".group-detail")
      ?.textContent?.includes("membership remains ambiguous"),
    "duplicate names remain ambiguous",
  );
  click("Inspect connection-a · pane-3");
  await waitFor(() =>
    document.querySelector("[data-inspected]")?.getAttribute("data-inspected"),
  );
  check(
    document
      .querySelector("[data-inspected]")
      ?.getAttribute("data-inspected") ===
      world.leaves.find(
        (leaf) =>
          leaf.connectionId === "connection-a" && leaf.nativeId === "pane-3",
      )?.id,
    "ambiguous match inspection opens only the qualified current terminal",
  );
  check(
    document
      .querySelector(".group-detail")
      ?.textContent?.includes("membership remains ambiguous"),
    "inspection never resolves ambiguous membership",
  );
  const groupInterest = document.querySelector<HTMLButtonElement>(
    '[aria-label^="Group interest:"]',
  )!;
  groupInterest.click();
  await waitFor(() =>
    document.querySelector('[role="group"][aria-label="Group interest"]'),
  );
  [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[role="group"][aria-label="Group interest"] button',
    ),
  ]
    .find((button) => button.textContent?.startsWith("Focused"))!
    .click();
  await waitFor(() =>
    document.querySelector('[aria-label="Group interest: Focused"]'),
  );
  document
    .querySelector<HTMLButtonElement>('[aria-label^="Interest:"]')!
    .click();
  await waitFor(() =>
    document.querySelector('[role="group"][aria-label="Interest"]'),
  );
  check(
    document.querySelectorAll('[role="group"][aria-label="Interest"] button')
      .length === 4,
    "agent interest distinguishes Default and force-Watch",
  );
  [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[role="group"][aria-label="Interest"] button',
    ),
  ]
    .find((button) => button.querySelector("b")?.textContent === "Watch")!
    .click();
  await waitFor(() =>
    document.querySelector(
      '[aria-label^="Interest: Watched · individual override"]',
    ),
  );
  check(
    document
      .querySelector(".group-status-line")
      ?.textContent?.includes("1 needs you"),
    "interest never removes needs-you status/counts",
  );
  document
    .querySelector<HTMLButtonElement>(
      '[aria-label="More actions for fixture agent"]',
    )!
    .click();
  await waitFor(() => document.querySelector('[role="menu"]'));
  const defaultChoice = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
  ].find((button) => button.textContent?.startsWith("Default (from groups)"));
  const watchChoice = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
  ].find(
    (button) =>
      button.textContent?.startsWith("Watch") &&
      !button.textContent?.startsWith("Watching"),
  );
  check(
    Boolean(
      defaultChoice && watchChoice?.getAttribute("aria-checked") === "true",
    ),
    "mobile Attention offers Default separately from the explicit Watch override",
  );
  if (defaultChoice) {
    defaultChoice.click();
    await waitFor(() =>
      document.querySelector('[aria-label^="Interest: Focused · via"]'),
    );
    document
      .querySelector<HTMLButtonElement>(
        '[aria-label="More actions for fixture agent"]',
      )!
      .click();
    await waitFor(() => document.querySelector('[role="menu"]'));
    const inherited = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    ].find((button) => button.textContent?.startsWith("Default (from groups)"));
    check(
      inherited?.getAttribute("aria-checked") === "true",
      "mobile Default resumes group Focus and is the only checked Attention choice",
    );
    document
      .querySelector<HTMLButtonElement>(
        '[aria-label="More actions for fixture agent"]',
      )!
      .click();
  } else {
    document
      .querySelector<HTMLButtonElement>(
        '[aria-label="More actions for fixture agent"]',
      )!
      .click();
  }
  await waitFor(() => document.querySelector(".group-pr-pill.is-warning"));
  check(
    document.querySelectorAll(".group-detail .pr-card").length === 3,
    "Groups reuse linked PR cards",
  );
  click("Add…");
  await waitFor(() => document.querySelector(".group-edit select"));
  const select =
    document.querySelector<HTMLSelectElement>(".group-edit select")!;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )!.set!;
  setter.call(select, "connection-a\0terminal-1");
  flushSync(() => select.dispatchEvent(new Event("change", { bubbles: true })));
  document.querySelector<HTMLFormElement>(".group-edit")!.requestSubmit();
  await waitFor(() =>
    buttons().some((button) => button.textContent === "Confirm"),
  );
  await fetch("/advance", { method: "POST" });
  click("Confirm");
  await waitFor(() =>
    document.querySelector("[role=alert]")?.textContent?.includes("changed"),
  );
  check(
    ![...document.querySelectorAll(".group-detail .group-member-name b")].some(
      (member) => member.textContent === "b",
    ),
    "stale confirmation must not transfer a new role",
  );
  click("Back to Groups");
  await waitFor(() => document.querySelector(".group-roster"));
  check(
    document
      .querySelector(".group-roster")
      ?.textContent?.includes("Town updated"),
    "revision conflict refreshes the roster",
  );
  if (!params.has("capture")) root.unmount();
  worldRuntimeStore.stop();
  await fetch("/result", { method: "POST", body: JSON.stringify(failures) });
}
run().catch(async (error) => {
  await fetch("/result", {
    method: "POST",
    body: JSON.stringify([
      ...failures,
      error instanceof Error
        ? (error.stack?.split("\n").slice(0, 8).join("\n") ?? String(error))
        : String(error),
    ]),
  });
});
