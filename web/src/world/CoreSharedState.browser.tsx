import { withTestClock } from "./testing/testClock";
import { clock as fixtureTime } from "./testing/installLightTownRenderer";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { bridge } from "../api";
import { BoardPeek } from "./board/BoardPeek";
import type {
  BoardDocumentStore,
  BoardOp,
  DeskPin,
} from "./board/boardDocument";
import { CORE_LOOK_DWELL_MS } from "./coreSeen";
import { WorldDeskStore } from "./deskStateStore";
import { projectAgent } from "./officeAgent";
import { worldRuntimeStore } from "./runtimeStore";
import { TownPeek } from "./town/TownPeek";
import { useDeskPins } from "./useDeskPins";
import { buildWorldObject, type WorldLeafObject } from "./worldObject";
import "../styles/tokens.css";
import "../styles/base.css";
import "./world.css";
import "./town/town.css";
import "./board/boardAppearance.css";

// Seen and the one pin shared with Herdr's apps, end to end: the page's World
// calls go to the test's World service handler, the production core
// provider and an in-process core; the snapshot is the production read
// model. "The app" is a second client the test drives on request.

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const advanceTime = (ms: number) => fixtureTime.advance(ms);
window.addEventListener("error", (event) => failures.push(String(event.error)));
const consoleError = console.error;
console.error = (...args: unknown[]) => {
  failures.push(args.map(String).join(" ").slice(0, 400));
  consoleError(...args);
};

/** Foreground changes during the run (a lost focus ends a look). */
const foregroundEvents: string[] = [];
for (const name of ["focus", "blur"] as const)
  window.addEventListener(name, () => foregroundEvents.push(name));
document.addEventListener("visibilitychange", () =>
  foregroundEvents.push(document.visibilityState),
);

const rpcErrors: string[] = [];

/** World methods the page called, with their parameters. */
const sent: Array<{ method: string; params: Record<string, unknown> }> = [];
const post = async (path: string, body: unknown) =>
  (await fetch(path, { method: "POST", body: JSON.stringify(body) })).json();
Object.assign(bridge, {
  call: async (method: string, params: Record<string, unknown>) => {
    // World's runtime store (the peeks' pins read it) observes the fixture.
    if (method === "world.snapshot") return (await fetch("/snapshot")).json();
    if (!method.startsWith("world.core.")) return null;
    sent.push({ method, params });
    const reply = await post("/rpc", { method, params });
    if (reply.error) {
      rpcErrors.push(`${method}: ${reply.error}`);
      throw new Error(reply.error);
    }
    return reply.result;
  },
  connection: (connectionId: string) => ({
    connectionId,
    isCurrent: () => false,
    call: async () => null,
  }),
  onControl: () => () => {},
  onStatus: () => () => {},
});
const deskStore = new WorldDeskStore({
  call: async () => null,
  onControl: () => () => {},
  onStatus: () => () => {},
});

async function world() {
  await withTestClock(fixtureTime, worldRuntimeStore.refresh());
  return buildWorldObject(worldRuntimeStore.get().connections);
}

async function scout(
  until: (leaf: WorldLeafObject) => boolean,
  what: string,
): Promise<WorldLeafObject & { kind: "agent" }> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const found = (await world()).leaves.find(
      (leaf) => leaf.kind === "agent" && leaf.agentName === "scout",
    );
    if (found && until(found))
      return found as WorldLeafObject & { kind: "agent" };
    await advanceTime(30);
  }
  throw new Error(`scout never became ${what}`);
}

/**
 * World's saved desk pins (the service's board document), applying the desk
 * operations as the service does, and the desk pins Town is given.
 */
const saved: { desk_pins: Record<string, DeskPin> } = { desk_pins: {} };
const boardListeners = new Set<() => void>();
const boardStore = {
  start: () => {},
  stop: () => {},
  subscribe: (listener: () => void) => {
    boardListeners.add(listener);
    return () => boardListeners.delete(listener);
  },
  get: () => ({ document: { layout: saved }, error: null }),
  patch: async (ops: BoardOp[]) => {
    const pins = { ...saved.desk_pins };
    for (const op of ops)
      if (op.op === "desk.pin") pins[op.key] = { cell: op.cell };
      else if (op.op === "desk.unpin") delete pins[op.key];
    saved.desk_pins = pins;
    for (const listener of boardListeners) listener();
    return null;
  },
} as unknown as BoardDocumentStore;
let townPins: Readonly<Record<string, DeskPin>> = {};
/** Town reads its desk pins alone: a core desk's pin is its label. */
function TownDeskPins() {
  townPins = useDeskPins(boardStore);
  return null;
}
const coreDesk = () =>
  Object.keys(townPins).filter((key) => key.startsWith("core-fixture:"));

const seenCalls = () =>
  sent.filter((call) => call.method === "world.core.seen");

async function run() {
  const viewport = document.createElement("meta");
  viewport.name = "viewport";
  viewport.content = "width=device-width, initial-scale=1";
  document.head.append(viewport);
  window.focus();
  check(
    document.visibilityState === "visible" && document.hasFocus(),
    "the page is in front of someone",
  );
  const root = createRoot(
    document.body.appendChild(document.createElement("div")),
  );
  flushSync(() =>
    createRoot(document.createElement("div")).render(<TownDeskPins />),
  );
  const show = (leaf: (WorldLeafObject & { kind: "agent" }) | null) => {
    const space = leaf ? (leaf.parentId as string) : "";
    flushSync(() =>
      root.render(
        leaf ? (
          <>
            <div
              className="town-view-shell"
              style={{
                position: "absolute",
                inset: "0 auto auto 0",
                width: 420,
                height: 320,
              }}
            >
              <TownPeek
                agent={projectAgent(leaf, space, space, new Map())}
                where="web · research"
                conversation={null}
                question={[]}
                choices={[]}
                canReply={false}
                anchor={{ x: 40, y: 60 }}
                onAnswer={() => {}}
                onChat={() => {}}
                onTerminal={() => {}}
                onNext={null}
                onClose={() => {}}
                onHold={() => {}}
                onReviewed={() => {}}
              />
            </div>
            <div className="board" style={{ display: "contents" }}>
              <BoardPeek
                target={{
                  leaf,
                  name: "scout",
                  where: "research · web",
                  canReply: false,
                  anchor: { x: 40, y: 420 },
                }}
                notify={(_kind, text) => failures.push(text)}
                deskStore={deskStore}
                onOpen={() => {}}
                onClose={() => {}}
                onHold={() => {}}
              />
            </div>
          </>
        ) : null,
      ),
    );
  };

  // 1. The scout finished a turn while nobody looked: done.
  let leaf = await scout((l) => l.status === "done", "done");
  check(leaf.pane.turn === 1, `scout's turn is 1: ${leaf.pane.turn}`);

  // 2. A glance shorter than the dwell is not looking.
  show(leaf);
  await advanceTime(CORE_LOOK_DWELL_MS / 3);
  show(null);
  await advanceTime(CORE_LOOK_DWELL_MS);
  check(seenCalls().length === 0, "a passing glance shares nothing");

  // 3. Both peeks stay drawn: one write for turn 1, then idle everywhere.
  show(leaf);
  await advanceTime(CORE_LOOK_DWELL_MS + 200);
  check(
    seenCalls().length === 1 &&
      JSON.stringify(seenCalls()[0]!.params) ===
        JSON.stringify({
          connection_id: leaf.connectionId,
          connection_generation: leaf.generation,
          terminal: leaf.pane.pane_id,
          turn: 1,
          // Decided on the missing label: written only while it still is.
          seen: null,
        }),
    `one seen write for the turn: ${JSON.stringify(seenCalls())}`,
  );
  leaf = await scout((l) => l.status === "idle", "idle");
  show(leaf);

  // 4. The app marks it unread while World still shows it: it stays unread.
  await post("/app", { action: "unread" });
  leaf = await scout((l) => l.status === "done", "done again");
  show(leaf);
  await advanceTime(CORE_LOOK_DWELL_MS + 200);
  check(
    seenCalls().length === 1,
    `World kept the app's unread: ${seenCalls().length} writes (${foregroundEvents.join(",")}) ${rpcErrors.join("; ")}`,
  );
  check(
    (await scout(() => true, "listed")).status === "done",
    "still done after a screen left on",
  );

  // 5. Pin from Town's peek: the label is set, both peeks show it, quietly.
  const pinButton = (where: string) =>
    document.querySelector<HTMLButtonElement>(
      `.${where}-peek .${where}-peek-pin`,
    );
  check(
    pinButton("town")?.getAttribute("aria-pressed") === "false",
    "not pinned yet",
  );
  check(
    !document.querySelector('[aria-label*="avourite"]'),
    "no separate favourite",
  );
  pinButton("town")?.click();
  leaf = await scout((l) => l.pane.favourite === true, "pinned");
  show(leaf);
  await advanceTime(50);
  check(
    [...document.querySelectorAll('[aria-label="Unpin"]')].length === 2,
    "both peeks show the pin",
  );
  const pinWrites = () =>
    sent.filter((c) => c.method === "world.core.favourite");
  check(
    pinWrites().length === 1 &&
      pinWrites()[0]!.params.favourite === true &&
      pinWrites()[0]!.params.terminal === leaf.pane.pane_id,
    `one pin write: ${JSON.stringify(pinWrites())}`,
  );

  // Town's desk wears the pin (it goes first in its room); World saves
  // nothing of its own for it.
  check(coreDesk().length === 1, `Town's desk is pinned: ${coreDesk()}`);
  const desk = coreDesk()[0]!;
  check(
    !saved.desk_pins[desk],
    `World saves no desk pin for a core desk: ${JSON.stringify(saved)}`,
  );

  // 6. Unpin from Board's peek clears it for every client; a pin made in the
  // app shows in World with no write from World.
  pinButton("board")?.click();
  leaf = await scout((l) => l.pane.favourite !== true, "unpinned");
  show(leaf);
  await advanceTime(50);
  check(
    pinWrites().length === 2 && pinWrites()[1]!.params.favourite === false,
    `one unpin write: ${JSON.stringify(pinWrites())}`,
  );
  check(
    [...document.querySelectorAll('[aria-label="Pin"]')].length === 2,
    "both peeks show it unpinned",
  );
  await advanceTime(50);
  check(
    coreDesk().length === 0 && !saved.desk_pins[desk],
    `Town's desk is unpinned: ${JSON.stringify(saved)}`,
  );
  await post("/app", { action: "pin" });
  leaf = await scout((l) => l.pane.favourite === true, "pinned in the app");
  show(leaf);
  await advanceTime(50);
  check(
    [...document.querySelectorAll('[aria-label="Unpin"]')].length === 2 &&
      pinWrites().length === 2,
    "the app's pin shows in both peeks",
  );
  check(
    coreDesk().length === 1 && townPins[desk]?.cell === null,
    "the app's pin pins Town's desk where it stands",
  );

  // 7. Looking again later raises seen again.
  show(null);
  await advanceTime(20);
  show(leaf);
  await advanceTime(CORE_LOOK_DWELL_MS + 200);
  check(seenCalls().length === 2, "a new look shares the turn again");
  leaf = await scout((l) => l.status === "idle", "idle again");
  show(leaf);
  await advanceTime(50);
}

void run()
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
  );
