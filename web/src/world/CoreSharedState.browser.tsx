import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { bridge } from "../api";
import { BoardPeek } from "./board/BoardPeek";
import { CORE_LOOK_DWELL_MS } from "./coreSeen";
import { WorldDeskStore } from "./deskStateStore";
import { projectAgent } from "./officeAgent";
import { WorldRuntimeStore } from "./runtimeStore";
import { TownPeek } from "./town/TownPeek";
import { buildWorldObject, type WorldLeafObject } from "./worldObject";
import "../styles/tokens.css";
import "../styles/base.css";
import "./world.css";
import "./town/town.css";
import "./board/boardAppearance.css";

// Seen and favourite shared with Herdr's apps, end to end: the page's World
// calls go to the test's World service handler, the production core
// provider and an in-process core; the snapshot is the production read
// model. "The app" is a second client the test drives on request.

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
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
  return buildWorldObject(store.get().connections);
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
    await sleep(30);
  }
  throw new Error(`scout never became ${what}`);
}

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
  await sleep(CORE_LOOK_DWELL_MS / 3);
  show(null);
  await sleep(CORE_LOOK_DWELL_MS);
  check(seenCalls().length === 0, "a passing glance shares nothing");

  // 3. Both peeks stay drawn: one write for turn 1, then idle everywhere.
  show(leaf);
  await sleep(CORE_LOOK_DWELL_MS + 200);
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
  await sleep(CORE_LOOK_DWELL_MS + 200);
  check(
    seenCalls().length === 1,
    `World kept the app's unread: ${seenCalls().length} writes (${foregroundEvents.join(",")}) ${rpcErrors.join("; ")}`,
  );
  check(
    (await scout(() => true, "listed")).status === "done",
    "still done after a screen left on",
  );

  // 5. Favourite from Town's peek: the label is set, both peeks show it.
  const star = document.querySelector<HTMLButtonElement>(
    ".town-peek .town-peek-favourite",
  );
  check(star?.getAttribute("aria-pressed") === "false", "not a favourite yet");
  star?.click();
  leaf = await scout((l) => l.pane.favourite === true, "a favourite");
  show(leaf);
  await sleep(50);
  check(
    [...document.querySelectorAll('[aria-label="Remove from favourites"]')]
      .length === 2,
    "both peeks show the favourite",
  );

  // 6. Pinning a desk or card is World's own: no favourite write from here on.
  const favourites = sent.filter((c) => c.method === "world.core.favourite");
  check(
    favourites.length === 1 &&
      favourites[0]!.params.favourite === true &&
      favourites[0]!.params.terminal === leaf.pane.pane_id,
    `one favourite write: ${JSON.stringify(favourites)}`,
  );

  // 7. Looking again later raises seen again.
  show(null);
  await sleep(20);
  show(leaf);
  await sleep(CORE_LOOK_DWELL_MS + 200);
  check(seenCalls().length === 2, "a new look shares the turn again");
  leaf = await scout((l) => l.status === "idle", "idle again");
  show(leaf);
  await sleep(50);
}

void run()
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
  );
