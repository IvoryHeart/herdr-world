import { useRef } from "react";
import { useDrawReadiness } from "./useDrawReadiness";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { bridge, type ConnectionClient } from "../api";
import { initializeLayoutPreferences } from "../layoutPreferences";
import { initializeShortcutPreferences } from "../shortcutPreferences";
import { __storeTesting, emptyServerSessionState, store } from "../store";
import { CoreKillConfirmHost } from "./CoreKillConfirm";
import { CoreWorktreesHost, openCoreWorktrees } from "./CoreWorktrees";
import { spaceRoomActionCapabilities } from "./officeRoomActions";
import { worldRuntimeStore } from "./runtimeStore";
import WorldInspectorConversationView from "./WorldInspectorConversation";
import {
  worldInspectorContext,
  worldIntentViews,
} from "./worldInspectorSelection";
import {
  buildWorldObject,
  inspectorAdmits,
  type WorldLeafObject,
  type WorldSpaceObject,
} from "./worldObject";
import { worldInspectorForNode } from "./worldTerminalPresentation";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/vendor.css";
import "./world.css";

// A herdr-core agent's Files and its room's worktrees, end to end: the page
// talks to the test's real core side (an in-process core, the production
// read model, World's host consumers and worktree operations) over a real
// Git repository. `?stage=` stops at a step so the test can capture it.

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const search = new URLSearchParams(location.search);
const stage = search.get("stage");
/** The new worktree's branch (captures make one per run). */
const branch = search.get("branch") ?? "feature-x";
window.addEventListener("error", (event) => failures.push(String(event.error)));
const consoleError = console.error;
console.error = (...args: unknown[]) => {
  const text = args.map(String).join(" ");
  // React's act() warnings are not failures of the product.
  if (!/not wrapped in act/.test(text)) failures.push(text.slice(0, 400));
  consoleError(...args);
};

type Call = {
  connection_id: string | null;
  connection_generation: number | null;
  method: string;
  params: Record<string, unknown>;
};
/** Every request the page made, as the test server received it. */
const calls: Call[] = [];
async function rpc(call: Call) {
  calls.push(call);
  const response = await fetch("/rpc", {
    method: "POST",
    body: JSON.stringify(call),
  });
  const reply = (await response.json()) as {
    result?: unknown;
    error?: { message: string; plan?: unknown };
  };
  if (reply.error) throw new Error(reply.error.message);
  return reply.result;
}

function until(predicate: () => boolean, label: string, ms = 20_000) {
  return new Promise<void>((resolve, reject) => {
    const started = performance.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (performance.now() - started > ms)
        return reject(new Error(`timed out: ${label}`));
      setTimeout(tick, 40);
    };
    tick();
  });
}

const query = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector);
const buttonNamed = (name: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === name,
  );

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function world() {
  await worldRuntimeStore.refresh();
  return buildWorldObject(worldRuntimeStore.get().connections);
}

function CaptureSurface({ element }: { element: HTMLElement }) {
  const root = useRef(element);
  useDrawReadiness("desk", root);
  return null;
}

async function run() {
  const viewport = document.createElement("meta");
  viewport.name = "viewport";
  viewport.content = "width=device-width, initial-scale=1";
  document.head.append(viewport);
  initializeLayoutPreferences();
  initializeShortcutPreferences();
  Object.assign(bridge, {
    // Bridge-global: World's observation and world.core.*.
    call: async (method: string, params: Record<string, unknown> = {}) =>
      method === "world.snapshot"
        ? (await fetch("/snapshot")).json()
        : rpc({
            connection_id: null,
            connection_generation: null,
            method,
            params,
          }),
    // A core connection's generation-qualified client (Files, Git).
    connection: (
      connectionId: string,
      generation: number | null = null,
    ): ConnectionClient => ({
      connectionId,
      generation: 1,
      serverRuntimeGeneration: generation,
      call: (method: string, params: Record<string, unknown> = {}) =>
        rpc({
          connection_id: connectionId,
          connection_generation: generation,
          method,
          params,
        }),
      isCurrent: () => true,
      acceptsServerGeneration: (value: unknown) => value === generation,
    }),
    onControl: () => () => {},
    onStatus: () => () => {},
  });
  __storeTesting.replaceState({
    ...store.get(),
    ...emptyServerSessionState(null),
    status: "connected",
    connectionPaused: false,
    catalogueReady: true,
  });
  const before = await world();
  const agent = before.leaves.find(
    (leaf) => leaf.kind === "agent" && leaf.agentName === "builder",
  ) as WorldLeafObject | undefined;
  if (!agent) throw new Error("the read model lists the core agent");
  // The capability rule: Files and Changes, never terminal, chat or history.
  check(
    agent.capabilities.files &&
      agent.capabilities.changes &&
      !agent.capabilities.openTerminal &&
      !agent.capabilities.agentHistory &&
      !agent.capabilities.openSpaces,
    `a core agent offers only Files and Changes: ${JSON.stringify(agent.capabilities)}`,
  );
  check(
    !agent.actionable && Boolean(agent.viewOnly) && inspectorAdmits(agent),
    "a core agent stays view-only yet its window opens",
  );
  check(
    JSON.stringify(worldIntentViews(agent)) === '["files","changes"]',
    `its window has Files and Changes: ${JSON.stringify(worldIntentViews(agent))}`,
  );
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;display:flex";
  document.body.append(host);
  const target = document.createElement("div");
  target.style.cssText = "flex:1;min-width:0;height:100%";
  host.append(target);
  const conversation = worldInspectorForNode(
    agent,
    "files",
    worldIntentViews(agent),
    worldInspectorContext(agent)!,
    { dock: "right", expanded: true, size: 640 },
  );
  if (!conversation) throw new Error("the core agent's window opens on Files");
  const root = document.createElement("div");
  document.body.append(root);
  flushSync(() =>
    createRoot(root).render(
      <>
        <CaptureSurface element={host} />
        <WorldInspectorConversationView
          conversation={conversation}
          target={target}
          floating={false}
          terminalActive={false}
          onChange={() => {}}
          onClose={() => {}}
          onResourceFocus={() => {}}
          onTerminalPortalChange={() => {}}
        />
        <CoreWorktreesHost />
        <CoreKillConfirmHost />
      </>,
    ),
  );
  // Files lists the agent's worktree (its live folder), and opens a file.
  await until(
    () =>
      [...document.querySelectorAll(".file-name")].some(
        (name) => name.textContent === "README.md",
      ),
    "Files lists the agent's checkout",
  );
  const worktreeRead = calls.find(
    (call) => call.method === "agent_worktree.get",
  );
  const subject = worktreeRead?.params.subject as
    | Record<string, unknown>
    | undefined;
  check(
    worktreeRead?.connection_id === "box" &&
      worktreeRead.connection_generation === agent.generation &&
      subject?.paneId === agent.nativeId &&
      subject?.terminalId === agent.terminalId &&
      subject?.sessionFingerprint === null,
    `the worktree read names the core terminal and its generation: ${JSON.stringify(worktreeRead)}`,
  );
  const fileCalls = calls.filter((call) => call.method.startsWith("file."));
  check(
    fileCalls.length > 0 &&
      fileCalls.every(
        (call) =>
          call.connection_id === "box" &&
          call.connection_generation === agent.generation,
      ),
    "every file read names the core connection and its generation",
  );
  [...document.querySelectorAll<HTMLElement>(".file-name")]
    .find((name) => name.textContent === "README.md")
    ?.closest<HTMLElement>("button, [role=treeitem], .file-row")
    ?.click();
  await until(
    () => document.body.textContent?.includes("hello from core") === true,
    "the file preview shows the file",
  );
  if (stage === "files") return;
  target.style.display = "none";

  // Worktrees of the agent's room: list, create, open, remove.
  const room = (w: typeof before, label: string) =>
    w.spaces.find((space) => space.label === label) as
      | WorldSpaceObject
      | undefined;
  const home = before.spaces.find(
    (space) => space.nativeId === agent.workspaceId,
  )!;
  const homeCan = spaceRoomActionCapabilities(home);
  check(
    homeCan.worktrees === true && homeCan.linkedWorktree !== true,
    `a core room offers worktrees and is not one: ${JSON.stringify(homeCan)}`,
  );
  openCoreWorktrees({
    connectionId: home.connectionId,
    generation: home.generation,
    workspaceId: home.nativeId,
    label: home.label,
    linked: false,
  });
  await until(
    () => document.querySelectorAll(".core-worktrees-list li").length >= 2,
    "the dialog lists the repository's worktrees",
  );
  check(
    document
      .querySelector(".core-worktrees-list")
      ?.textContent?.includes("existing-wt") === true,
    "the dialog lists a worktree Git already has",
  );
  if (stage === "dialog") return;
  typeInto(query<HTMLInputElement>(".core-worktrees-new input")!, branch);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  buttonNamed("Create worktree")!.click();
  let after = before;
  const poll = setInterval(() => {
    void world().then((next) => (after = next));
  }, 150);
  try {
    await until(
      () => Boolean(room(after, branch)),
      "the new worktree is a room",
    );
    const created = room(after, branch)!;
    const createdCan = spaceRoomActionCapabilities(created);
    check(
      createdCan.linkedWorktree === true &&
        created.workspace.worktree?.is_linked_worktree === true &&
        created.workspace.worktree?.checkout_path?.endsWith(`/${branch}`) ===
          true,
      `the new room is the linked checkout: ${JSON.stringify(created.workspace)}`,
    );
    // Open the worktree Git already lists, as a room.
    openCoreWorktrees({
      connectionId: home.connectionId,
      generation: home.generation,
      workspaceId: home.nativeId,
      label: home.label,
      linked: false,
    });
    await until(
      () => document.querySelectorAll(".core-worktrees-list li").length >= 3,
      "the dialog lists the new worktree too",
    );
    const existingRow = [
      ...document.querySelectorAll<HTMLElement>(".core-worktrees-list li"),
    ].find((row) => row.textContent?.includes("existing-wt"))!;
    // Already a room when an earlier run opened it.
    const openButton = buttonNamed("Open", existingRow);
    check(
      Boolean(openButton) || Boolean(room(after, "existing-wt")),
      "an existing worktree that is not a room offers Open",
    );
    openButton?.click();
    await until(
      () => Boolean(room(after, "existing-wt")),
      "the existing worktree is a room",
    );
    // Remove the new one: the confirmation names what ends (nothing here).
    openCoreWorktrees({
      connectionId: created.connectionId,
      generation: created.generation,
      workspaceId: created.nativeId,
      label: created.label,
      linked: true,
    });
    await until(
      () => Boolean(buttonNamed("Remove this worktree…")),
      "the dialog offers Remove for a linked worktree",
    );
    buttonNamed("Remove this worktree…")!.click();
    await until(
      () =>
        query(".modal[aria-label='Remove worktree']") !== null &&
        query(".modal[aria-label='Remove worktree']")!.textContent!.includes(
          "no running terminals",
        ),
      "the removal asks first",
    );
    if (stage === "remove") return;
    buttonNamed("Remove worktree")!.click();
    await until(
      () => !room(after, branch) && Boolean(room(after, "existing-wt")),
      "the removed worktree's room is gone",
    );
    const removal = calls.find(
      (call) => call.method === "world.core.worktree.remove",
    );
    check(
      removal?.params.connection_id === "box" &&
        removal.params.connection_generation === created.generation &&
        removal.params.workspace_id === created.nativeId &&
        removal.params.confirmation === undefined,
      `removal names its room and generation: ${JSON.stringify(removal)}`,
    );
  } finally {
    clearInterval(poll);
  }
}

void run()
  .catch((error) => {
    failures.push(String(error));
    failures.push(document.body.innerText.slice(0, 2500));
    failures.push(JSON.stringify(calls).slice(-3500));
  })
  .finally(() =>
    fetch("/result", {
      method: "POST",
      body: JSON.stringify({ failures, calls: calls.map((c) => c.method) }),
    }),
  );
