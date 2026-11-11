import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { bridge } from "../api";
import { BoardPeek } from "./board/BoardPeek";
import { WorldDeskStore } from "./deskStateStore";
import { NeedsYouList } from "./NeedsYouTab";
import { needsYouLeafKey } from "./needsYou";
import { projectAgent } from "./officeAgent";
import { WorldRuntimeStore } from "./runtimeStore";
import { TownPeek } from "./town/TownPeek";
import {
  buildWorldObject,
  CORE_VIEW_ONLY_REASON,
  type WorldLeafObject,
} from "./worldObject";
import type { WorldAsksStore } from "./worldAsks";
import "../styles/tokens.css";
import "../styles/base.css";
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
Object.assign(bridge, {
  // World-wide reads (asks, usage) are not about any agent.
  call: async () => null,
  connection: (connectionId: string) => ({
    connectionId,
    isCurrent: () => false,
    call: (method: string) => record(`${connectionId}:${method}`),
  }),
  onControl: () => () => {},
  onStatus: () => () => {},
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
            width: 420,
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
  const disabled = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .filter((button) => button.disabled)
    .map((button) => button.title);
  check(
    disabled.filter((title) => title === CORE_VIEW_ONLY_REASON).length >= 5,
    `controls stay visible, disabled with the reason: ${JSON.stringify(disabled)}`,
  );
  const terminal = document.querySelector<HTMLButtonElement>(
    ".town-peek-terminal",
  );
  check(
    terminal?.disabled === true && terminal.title === CORE_VIEW_ONLY_REASON,
    "Town's Open terminal is disabled with the reason",
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
  check(
    !document.body.textContent?.includes("Loading conversation"),
    "nothing waits on a conversation World cannot read",
  );
}

void run()
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
  );
