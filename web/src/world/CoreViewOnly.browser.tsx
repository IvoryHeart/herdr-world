import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { bridge } from "../api";
import { BoardPeek } from "./board/BoardPeek";
import { WorldDeskStore } from "./deskStateStore";
import { NeedsYouList } from "./NeedsYouTab";
import { CORE_WATCH_TITLE } from "./viewOnly";
import { needsYouLeafKey } from "./needsYou";
import { projectAgent } from "./officeAgent";
import { WorldRuntimeStore } from "./runtimeStore";
import { TownPeek } from "./town/TownPeek";
import { FloatShellOverlay } from "../components/FloatShellOverlay";
import {
  buildWorldObject,
  CORE_VIEW_ONLY_REASON,
  type WorldLeafObject,
} from "./worldObject";
import type { WorldAsksStore } from "./worldAsks";
import "../styles/tokens.css";
import "../styles/base.css";
// The app loads xterm's styles with TerminalView's chunk before the overlay.
import "@xterm/xterm/css/xterm.css";
import "./world.css";
import "./town/town.css";
import "./town/townAsks.css";
import "./board/boardAppearance.css";

// Core agents as the server's read model lists them (served by the test from
// the production provider): Needs you, Town's peek and Board's peek. The page
// never reaches a runtime; every call is recorded so the test can prove World
// sends nothing for a view-only agent.

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
window.addEventListener("error", (event) => failures.push(String(event.error)));
const consoleError = console.error;
console.error = (...args: unknown[]) => {
  failures.push(args.map(String).join(" ").slice(0, 400));
  consoleError(...args);
};
/** Calls a view-only agent's controls or reads would make. */
const calls: string[] = [];
const record = async (method: string) => {
  calls.push(method);
  return null;
};
/**
 * World's float shell as the service answers it (`server/src/rpc/float.ts`):
 * the reply, then the stream's pushes as control messages. The shell echoes
 * what is typed; its prompt's last character arrives split across pushes.
 */
const float = {
  opens: [] as Record<string, unknown>[],
  typed: [] as string[],
  hidden: [] as string[],
  stopped: [] as string[],
  resized: 0,
  running: false,
  stream: 0,
  /** The core connection's current generation and agent room. */
  generation: -1,
  room: "",
  handlers: new Set<(control: unknown) => void>(),
  statusHandlers: new Set<(status: string) => void>(),
  status(status: string) {
    for (const handler of float.statusHandlers) handler(status);
  },
  push(control: Record<string, unknown>) {
    for (const handler of float.handlers) handler(control);
  },
  output(stream: string, bytes: Uint8Array) {
    let text = "";
    for (const byte of bytes) text += String.fromCharCode(byte);
    float.push({ type: "float_output", stream, data: btoa(text) });
  },
};
async function floatCall(method: string, params: Record<string, unknown>) {
  if (method === "world.float.open") {
    float.opens.push(params);
    // The service's own refusals (`FloatShellService.open`).
    if (params.connection_generation !== float.generation)
      throw new Error("herdr-core reconnected; open the float shell again");
    if (params.room !== float.room)
      throw new Error("That agent is in another room now");
    const stream = `float-${++float.stream}`;
    const created = !float.running;
    float.running = true;
    // After the reply, as the service sends them.
    setTimeout(() => {
      const prompt = new TextEncoder().encode("scout-room$ café ");
      const split = prompt.length - 2; // between the two bytes of "é"
      float.output(stream, prompt.slice(0, split));
      float.output(stream, prompt.slice(split));
    }, 0);
    return {
      stream,
      address: "t9",
      name: "world-float-fixture",
      room: "hc:space:fx-web",
      created,
    };
  }
  const stream = String(params.stream);
  if (method === "world.float.input") {
    const text = atob(String(params.data));
    float.typed.push(text);
    float.output(
      stream,
      Uint8Array.from(text.replace(/\r/g, "\r\n"), (c) => c.charCodeAt(0)),
    );
  } else if (method === "world.float.resize") float.resized += 1;
  else if (method === "world.float.hide") float.hidden.push(stream);
  else if (method === "world.float.stop") {
    float.stopped.push(stream);
    float.running = false;
    setTimeout(() =>
      float.push({
        type: "float_closed",
        stream,
        reason: "The shell was ended",
        ended: true,
      }),
    );
  }
  return { ok: true };
}
Object.assign(bridge, {
  // World-wide reads (asks, usage) are not about any agent.
  call: async (method: string, params: Record<string, unknown> = {}) =>
    method.startsWith("world.float.") ? floatCall(method, params) : null,
  onControl: (handler: (control: unknown) => void) => {
    float.handlers.add(handler);
    return () => float.handlers.delete(handler);
  },
  connection: (connectionId: string) => ({
    connectionId,
    isCurrent: () => false,
    call: (method: string) => record(`${connectionId}:${method}`),
  }),
  onStatus: (handler: (status: string) => void) => {
    float.statusHandlers.add(handler);
    return () => float.statusHandlers.delete(handler);
  },
});
const deskStore = new WorldDeskStore({
  call: async () => null,
  onControl: () => () => {},
  onStatus: () => () => {},
});
const NO_ASKS: never[] = [];
const asksStore = {
  get: () => NO_ASKS,
  subscribe: () => () => {},
  start: () => {},
  stop: () => {},
  answer: async () => null,
  dismiss: async () => null,
} as unknown as WorldAsksStore;

async function run() {
  // A phone lays out at its own width, as World's page does.
  const viewport = document.createElement("meta");
  viewport.name = "viewport";
  viewport.content = "width=device-width, initial-scale=1";
  document.head.append(viewport);
  const snapshot = await (await fetch("/snapshot")).json();
  const store = new WorldRuntimeStore(
    {
      call: async () => snapshot,
      connection: () => ({ isCurrent: () => false }),
      onControl: () => () => {},
      onStatus: () => () => {},
    },
    async () => {},
  );
  await store.refresh();
  const world = buildWorldObject(store.get().connections);
  const core = world.leaves.filter((leaf) => leaf.kind === "agent");
  const named = (name: string) =>
    core.find((leaf) => leaf.agentName === name) as WorldLeafObject & {
      kind: "agent";
    };
  const reviewer = named("reviewer");
  const scout = named("scout");
  check(Boolean(reviewer && scout), "the read model lists the core agents");
  const space = world.spaces[0]!;
  const agent = projectAgent(reviewer, space.id, space.parentId, new Map());
  const root = document.createElement("div");
  document.body.append(root);
  flushSync(() =>
    createRoot(root).render(
      <>
        <aside
          className="needs-you-tab"
          style={{ top: 0, height: "100%", right: 0, left: "auto" }}
        >
          <NeedsYouList
            world={world}
            request={{ sequence: 0 }}
            now={60_000}
            onChat={(id) => calls.push(`chat:${id}`)}
            onOpenTerminal={(id) => calls.push(`terminal:${id}`)}
            asksStore={asksStore}
            deskStore={deskStore}
          />
        </aside>
        <div
          className="town-view-shell"
          style={{
            position: "absolute",
            inset: "0 auto auto 0",
            // Within a phone, so the page keeps the device width.
            width: "min(420px, 100vw)",
            height: 320,
          }}
        >
          <TownPeek
            agent={agent}
            where="web · review"
            conversation={null}
            question={[]}
            choices={[]}
            canReply={false}
            anchor={{ x: 40, y: 60 }}
            onAnswer={() => calls.push("answer")}
            onChat={() => calls.push("town-chat")}
            onTerminal={() => calls.push("town-terminal")}
            leaf={reviewer}
            onNext={null}
            onClose={() => {}}
            onHold={() => {}}
            onReviewed={() => calls.push("town-reviewed")}
          />
        </div>
        <div
          className="board"
          // Board's palette only: no board surface around the peek.
          style={{ display: "contents" }}
        >
          <BoardPeek
            target={{
              leaf: scout,
              name: "scout",
              where: "research · web",
              canReply: false,
              anchor: { x: 40, y: 420 },
            }}
            notify={() => {}}
            deskStore={deskStore}
            onOpen={() => calls.push("board-open")}
            onClose={() => {}}
            onHold={() => {}}
          />
        </div>
        <FloatShellOverlay
          terminalTheme={{}}
          terminalFontScale={100}
          authority={(id) => (id === "core-fixture" ? float.generation : null)}
        />
      </>,
    ),
  );
  for (let i = 0; i < 6; i++) await frame();
  const item = document.querySelector<HTMLElement>(
    `[data-needs-you-item=${JSON.stringify(needsYouLeafKey(reviewer.id))}]`,
  );
  check(Boolean(item), "Needs you lists the waiting core agent");
  check(
    item?.textContent?.includes("Which branch should I merge into?") === true,
    `Needs you shows the program's own words: ${item?.textContent}`,
  );
  check(
    item?.textContent?.includes(CORE_VIEW_ONLY_REASON) === true,
    "Needs you says why it is view only",
  );
  const answerField = item?.querySelector<HTMLInputElement>(
    ".needs-you-field input",
  );
  const answerSend = item?.querySelector<HTMLButtonElement>(
    ".needs-you-field .needs-you-send",
  );
  check(
    answerField?.disabled === true &&
      answerField.title === CORE_VIEW_ONLY_REASON &&
      answerSend?.disabled === true &&
      answerSend.title === CORE_VIEW_ONLY_REASON,
    "Needs you keeps the answer field and Send, disabled with the reason",
  );
  const disabled = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .filter((button) => button.disabled)
    .map((button) => button.title);
  check(
    disabled.filter((title) => title === CORE_VIEW_ONLY_REASON).length >= 2,
    `controls stay visible, disabled with the reason: ${JSON.stringify(disabled)}`,
  );
  // Its terminal can be watched (never typed into) from every surface.
  const watchButtons = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].filter((button) => button.title === CORE_WATCH_TITLE);
  check(
    // Needs you lists two core agents (one waiting, one finished).
    watchButtons.length === 4 && watchButtons.every((b) => !b.disabled),
    `Needs you, Town and Board offer the watch: ${watchButtons.length}`,
  );
  const terminal = document.querySelector<HTMLButtonElement>(
    ".town-peek-terminal",
  );
  check(
    terminal?.disabled === false && terminal.title === CORE_WATCH_TITLE,
    "Town's Open terminal watches",
  );
  check(
    document.querySelector(".town-peek .is-view-only") !== null &&
      document.querySelector(".board-peek .is-view-only") !== null,
    "both peeks show the view-only note",
  );
  // Disabled controls never fire, and no read names the core connection.
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "button:disabled",
  ))
    button.click();
  await frame();
  check(
    calls.length === 0,
    `World sent nothing for view-only agents: ${calls.join(", ")}`,
  );
  for (const button of watchButtons) button.click();
  await frame();
  check(
    calls.length === 4 &&
      ["board-open", "town-terminal", `terminal:${reviewer.id}`].every((c) =>
        calls.includes(c),
      ) &&
      calls.every((c) => /^(board-open|town-terminal|terminal:)/.test(c)),
    `watching opens the terminal and reads nothing: ${calls.join(", ")}`,
  );
  check(
    !document.body.textContent?.includes("Loading conversation"),
    "nothing waits on a conversation World cannot read",
  );
  await floatShell(scout);
}

const rowsText = () =>
  [...document.querySelectorAll(".float-shell-screen .xterm-rows > div")]
    .map((row) => row.textContent ?? "")
    .join("\n");
async function until(predicate: () => boolean, what: string | (() => string)) {
  for (let i = 0; i < 120; i++) {
    if (predicate()) return true;
    await frame();
  }
  check(false, typeof what === "string" ? what : what());
  return false;
}

/** World's equivalent of Herdr Float on a core agent, from both peeks. */
async function floatShell(scout: WorldLeafObject) {
  const townShell = document.querySelector<HTMLButtonElement>(
    ".town-peek .town-peek-shell",
  );
  const boardShell = document.querySelector<HTMLButtonElement>(
    '.board-peek button[aria-label^="Open a shell"]',
  );
  check(
    townShell?.disabled === false && boardShell?.disabled === false,
    "a core agent's peeks offer its room's shell, enabled",
  );
  float.generation = scout.generation;
  float.room = scout.workspaceId;
  boardShell?.click();
  if (
    !(await until(
      () => rowsText().includes("scout-room$ café"),
      "the float shell shows its first paint",
    ))
  )
    return;
  const open = float.opens[0] ?? {};
  check(
    open.connection_id === "core-fixture" &&
      open.terminal_id === scout.pane.terminal_id &&
      open.connection_generation === scout.generation &&
      open.room === scout.workspaceId &&
      Number.isInteger(open.cols) &&
      Number(open.cols) > 20 &&
      Number.isInteger(open.rows) &&
      Number(open.rows) > 4,
    `opened for the agent's own room at the window's size: ${JSON.stringify(open)}`,
  );
  check(
    !rowsText().includes("\ufffd"),
    "a character split across pushes arrives whole",
  );
  const textarea = document.querySelector<HTMLTextAreaElement>(
    ".float-shell-screen .xterm-helper-textarea",
  );
  check(document.activeElement === textarea, "the shell has the keyboard");
  for (const key of ["p", "w", "d"]) {
    textarea?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        keyCode: key.toUpperCase().charCodeAt(0),
        bubbles: true,
      }),
    );
    textarea?.dispatchEvent(
      new KeyboardEvent("keyup", {
        key,
        keyCode: key.toUpperCase().charCodeAt(0),
        bubbles: true,
      }),
    );
  }
  textarea?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }),
  );
  await until(
    () => float.typed.join("") === "pwd\r",
    () => `keys reach the shell in order: ${JSON.stringify(float.typed)}`,
  );
  await until(() => rowsText().includes("café pwd"), "the shell's echo shows");
  // Hide: the view goes, the shell keeps running.
  document.querySelector<HTMLButtonElement>(".float-shell-hide")?.click();
  await until(
    () => !document.querySelector(".float-shell-window"),
    "Hide closes the window",
  );
  check(
    float.hidden.join() === "float-1" && float.running,
    "hiding leaves the shell running",
  );
  // Town's peek reopens the same room's shell; End shell ends it.
  townShell?.click();
  await until(
    () => rowsText().includes("scout-room$"),
    "Town's peek reopens the shell",
  );
  const end = [
    ...document.querySelectorAll<HTMLButtonElement>(".float-shell-action"),
  ].find((button) => button.textContent?.includes("End shell"));
  await until(() => end?.disabled === false, "End shell is offered once open");
  end?.click();
  await until(
    () => !document.querySelector(".float-shell-window"),
    "an ended shell closes its window",
  );
  check(
    float.stopped.join() === "float-2" && !float.running,
    "End shell ends exactly the open stream",
  );
  // Core reconnects: the stream closes without the shell ending, says why,
  // and Open again takes the connection's new generation, never the old one.
  boardShell?.click();
  await until(
    () => rowsText().includes("scout-room$"),
    "the shell opens again",
  );
  float.generation = scout.generation + 1;
  float.push({
    type: "float_closed",
    stream: `float-${float.stream}`,
    reason: "herdr-core reconnected; open the float shell again",
    ended: false,
  });
  await until(
    () => reasonText().includes("reconnected"),
    "a lost stream says why",
  );
  const before = float.opens.length;
  openAgain()?.click();
  await until(
    () => float.opens.length === before + 1 && !reasonText(),
    () => `Open again reopens: ${reasonText()}`,
  );
  const reopened = float.opens[before] ?? {};
  check(
    reopened.connection_generation === float.generation &&
      reopened.connection_id === "core-fixture" &&
      reopened.room === scout.workspaceId,
    `Open again uses the connection's current authority: ${JSON.stringify(reopened)}`,
  );
  await until(
    () => rowsText().includes("scout-room$"),
    "the reopened shell paints",
  );
  // World's own socket drops (a phone resuming): the service has left the
  // view, so it closes, keys go nowhere, and Open again works on return.
  const typed = float.typed.length;
  float.status("disconnected");
  await until(
    () => reasonText().includes("connection was lost"),
    () => `a lost World connection closes the view: ${reasonText()}`,
  );
  check(
    [
      ...document.querySelectorAll<HTMLButtonElement>(".float-shell-action"),
    ].find((button) => button.textContent?.includes("End shell"))?.disabled ===
      true,
    "End shell is not offered for a view that is gone",
  );
  document
    .querySelector<HTMLTextAreaElement>(
      ".float-shell-screen .xterm-helper-textarea",
    )
    ?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "x", keyCode: 88, bubbles: true }),
    );
  await frame();
  check(float.typed.length === typed, "keys are not sent to a gone stream");
  float.status("connecting");
  float.status("connected");
  const resumed = float.opens.length;
  openAgain()?.click();
  await until(
    () => float.opens.length === resumed + 1 && !reasonText(),
    () => `Open again works after World reconnects: ${reasonText()}`,
  );
  await until(
    () => rowsText().includes("scout-room$"),
    "the shell paints after World reconnects",
  );
  // The shell stays open for the evidence captures.
}

const reasonText = () =>
  document.querySelector(".float-shell-reason")?.textContent ?? "";
const openAgain = () =>
  [...document.querySelectorAll<HTMLButtonElement>(".float-shell-action")].find(
    (button) => button.textContent?.includes("Open again"),
  );

void run()
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
  );
