// First: the page runs on test time (see testing/testClock.ts).
import { clock } from "./testing/installTestClock";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { bridge } from "../api";
import {
  BOARD_ELEMENT_TYPES,
  parseBoardElement,
  type BoardElement,
  type BoardElementReadParams,
  type BoardElementReadResult,
} from "../../../shared/boardElements";
import BoardView from "./BoardView";
import {
  BoardDocumentStore,
  type BoardDocument,
  type BoardOp,
} from "./board/boardDocument";
import { fixtureHost, fixtureWorld } from "./board/boardFixture";
import { worldSourcesStore } from "./worldSources";
import {
  publishMemoryHosts,
  setMemoryClientForTests,
} from "./memory/memoryClient";
import { WORLD_MEMORY_EVENT } from "./memory/memoryEvents";
import { memoryFixtureClient } from "./memory/memoryFixture";
import { WORLD_APARTMENTS_EVENT } from "./apartments/apartmentsStore";
import { setApartmentsClient } from "./apartments/useApartments";
import {
  fixtureApartmentsClient,
  fixtureResidents,
} from "./testing/apartmentsFixture";
import "../styles/tokens.css";
import "../styles/base.css";
import "./world.css";

/*
 * Board's placed elements (memory, logs, docs, links) on a synthetic World:
 * the cards, the Add dialog listing every registered kind, and the reader.
 * The fake service validates writes with the service's own parser and
 * records every read. `?mode=test` runs the checks and posts them to /result;
 * `?mode=preview&shot=board|add|memory|log|link|offline` sets up one screen
 * for captures, then posts. Every host, project and file here is invented.
 */

// As World's page: phones lay it out at their own width.
const viewport = document.createElement("meta");
viewport.name = "viewport";
viewport.content = "width=device-width, initial-scale=1, viewport-fit=cover";
document.head.appendChild(viewport);
const params = new URL(location.href).searchParams;
const mode = params.get("mode") ?? "test";
const failures: string[] = [];
let current = "";
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(current ? `${current}: ${message}` : message);
};
window.addEventListener("error", (event) => failures.push(String(event.error)));
const settle = (ms = 50) => clock.advance(ms);
const waitFor = (condition: () => boolean, message: string, tries = 200) =>
  clock.until(condition, message, tries * 50);

// Board's other services answer empty: this page is about elements.
bridge.call = (async (method: string) => {
  if (method === "world.asks.get") return { revision: 0, asks: [] };
  throw new Error(`unexpected call ${method}`);
}) as typeof bridge.call;
worldSourcesStore.useFetch(async () =>
  Response.json({ observedAt: 1, sources: [], links: [], items: [] }),
);

// Apartments has the reviewer whose session the seeded log names, on the
// log's own host, and the same session on another host (never offered).
const reviewer = {
  ...fixtureResidents(Date.now())[0]!,
  id: "r-studio-reviewer",
  connection_id: "studio",
  connection_label: "studio",
  name: "reviewer",
  session_id: "reviewer",
};
setApartmentsClient(
  fixtureApartmentsClient(Date.now(), [
    reviewer,
    { ...reviewer, id: "r-build-reviewer", connection_id: "build-box" },
  ]),
);

/** The Library reads the synthetic memory catalog on studio, generation 1. */
function libraryOnStudio() {
  setMemoryClientForTests(memoryFixtureClient());
  publishMemoryHosts([
    {
      connection_id: "studio",
      connection_generation: 1,
      label: "studio",
      names: {},
    },
  ]);
}
const LIBRARY_MEMORY: BoardElement = {
  id: "memory-build-notes",
  kind: "memory",
  title: "Build notes",
  x: 240,
  y: 600,
  rev: 1,
  source: {
    connection_id: "studio",
    memory_source_id: "fx-codex-memories",
    path: "build-notes.md",
  },
};
/** Every Library or Apartments open the page asked for. */
const opened: [string, unknown][] = [];
window.addEventListener(WORLD_MEMORY_EVENT, (event) =>
  opened.push(["library", (event as CustomEvent).detail]),
);
window.addEventListener(WORLD_APARTMENTS_EVENT, (event) =>
  opened.push(["apartments", (event as CustomEvent).detail]),
);

const panes = (label: string) => ({
  label,
  tabs: [{ label: "main", panes: [["working"], ["idle", false]] as never }],
});
const world = fixtureWorld([
  fixtureHost("studio", [panes("web-app"), panes("docs-site")]),
  fixtureHost("build-box", [panes("nightly")], { stale: true }),
]);

const SEEDED: BoardElement[] = [
  {
    id: "memory-notes",
    kind: "memory",
    title: "Project memory",
    x: -240,
    y: 420,
    rev: 1,
    source: { connection_id: "studio", workspace_id: "w1", path: "notes" },
  },
  {
    id: "log-review",
    kind: "log",
    title: "Review session",
    x: 0,
    y: 420,
    rev: 1,
    source: {
      connection_id: "studio",
      workspace_id: "w1",
      path: "logs/review.jsonl",
      agent_ref: "reviewer",
    },
  },
  {
    id: "link-pr",
    kind: "link",
    title: "Login fix",
    x: 240,
    y: 420,
    rev: 1,
    source: { url: "https://github.com/example-org/web-app/pull/42" },
  },
  {
    id: "memory-nightly",
    kind: "memory",
    title: "Nightly memory",
    x: -240,
    y: 600,
    rev: 1,
    source: {
      connection_id: "build-box",
      workspace_id: "w1",
      path: "MEMORY.md",
    },
  },
];
const TRANSCRIPT = [
  { type: "user", message: { role: "user", content: "Review the login fix." } },
  {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", name: "Read", input: {} }],
    },
  },
  {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Two findings; both are small." }],
    },
  },
]
  .map((line) => JSON.stringify(line))
  .join("\n");

const emptyDocument = (): BoardDocument => ({
  version: 1,
  revision: 0,
  layout: { anchors: {}, offsets: {}, pinned: {}, folded: [] },
  notes: [],
  strings: [],
  elements: [],
  relations: { spawns: [], groups: [] },
});
let saved = emptyDocument();
/** Every element write and read the page sent (Board's own layout saves aside). */
const writes: BoardOp[] = [];
const reads: BoardElementReadParams[] = [];
const lastRead = () => reads[reads.length - 1];

function apply(ops: BoardOp[]) {
  const next = structuredClone(saved);
  const elements = next.elements ?? [];
  for (const op of ops) {
    if (op.op.startsWith("element.")) writes.push(structuredClone(op));
    if (op.op === "element.put") {
      const at = elements.findIndex((element) => element.id === op.element.id);
      if (at >= 0 && op.rev !== elements[at]!.rev)
        return { conflict: "That element changed elsewhere.", document: saved };
      // The service's own validator: what it refuses, this refuses.
      const element = parseBoardElement(op.element, at < 0 ? 1 : op.rev! + 1);
      if (at < 0) elements.push(element);
      else elements[at] = element;
    } else if (op.op === "element.delete") {
      const at = elements.findIndex((element) => element.id === op.id);
      if (at >= 0 && elements[at]!.rev !== op.rev)
        return { conflict: "That element changed elsewhere.", document: saved };
      if (at >= 0) elements.splice(at, 1);
    } else if (op.op === "note.put")
      next.notes.push({ ...op.note, rev: 1 } as never);
    else if (op.op === "layout.set") {
      Object.assign(next.layout.anchors, op.anchors ?? {});
      Object.assign(next.layout.offsets, op.offsets ?? {});
      Object.assign(next.layout.pinned, op.pinned ?? {});
    }
  }
  next.elements = elements;
  next.revision = saved.revision + 1;
  saved = next;
  return { document: structuredClone(saved) };
}

function readElement(params: BoardElementReadParams): BoardElementReadResult {
  reads.push(structuredClone(params));
  const element = saved.elements?.find((entry) => entry.id === params.id);
  if (!element) return { status: "unavailable", reason: "missing_element" };
  const ready = (
    content: Extract<BoardElementReadResult, { status: "ready" }>["content"],
  ): BoardElementReadResult => ({
    status: "ready",
    element,
    content,
  });
  if (element.kind === "link")
    return ready({
      type: "link",
      url: element.source.url,
      link_kind: "pull_request",
      fetch: false,
    });
  if (element.kind === "log")
    return ready({ type: "text", text: TRANSCRIPT, truncated: false });
  if (element.kind === "document" && "text" in element.source)
    return ready({ type: "text", text: element.source.text, truncated: false });
  if (params.path === "plan.md")
    return ready({
      type: "text",
      text: "# Plan\n\n- Ship the reader\n- Keep files where they are\n",
      truncated: false,
    });
  if (params.path === "missing.md")
    return { status: "unavailable", reason: "source_unavailable", element };
  return ready({
    type: "directory",
    entries: [
      { name: "plan.md", type: "file", size: 52 },
      { name: "missing.md", type: "file", size: 0 },
      { name: "archive", type: "directory", size: 0 },
    ],
    truncated: false,
  });
}

let store = newStore();
function newStore() {
  return new BoardDocumentStore({
    call: async (method, params) => {
      if (method === "world.board.get") return structuredClone(saved);
      if (method === "world.board.patch")
        return apply((params as { ops: BoardOp[] }).ops);
      if (method === "world.board.elements.read")
        return readElement(params as BoardElementReadParams);
      throw new Error(`unexpected call ${method}`);
    },
    onControl: () => () => {},
    onStatus: () => () => {},
  });
}

const host = document.createElement("div");
host.style.cssText = "position:fixed;inset:0";
document.body.appendChild(host);
const root = createRoot(host);
let mountKey = 0;
function mount() {
  root.render(
    <StrictMode>
      <BoardView
        key={++mountKey}
        world={world}
        selectedId={null}
        onSelect={() => {}}
        onOpen={() => {}}
        store={store}
      />
    </StrictMode>,
  );
}

const card = (id: string) =>
  host.querySelector<HTMLElement>(`[data-key="element:${id}"]`);
const reader = () => document.querySelector<HTMLElement>(".board-reader");
const addDialog = () =>
  document.querySelector<HTMLElement>(".board-add-dialog");
function pointer(target: Element, type: string, x: number, y: number) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: x,
      clientY: y,
    }),
  );
}
const centre = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};
async function tap(el: Element) {
  const at = centre(el);
  pointer(el, "pointerdown", at.x, at.y);
  await settle(40);
  pointer(el, "pointerup", at.x, at.y);
  await settle(100);
}
function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
const button = (scope: ParentNode, text: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
/** The Add control, from the row or the overflow menu on a narrow screen. */
async function openAdd() {
  let add = host.querySelector<HTMLButtonElement>(".board-control-add");
  if (!add) {
    host
      .querySelector<HTMLButtonElement>('[aria-label="Board settings"]')!
      .click();
    await waitFor(
      () => Boolean(host.querySelector(".board-control-add")),
      "Add to Board is in neither the row nor the menu",
    );
    add = host.querySelector<HTMLButtonElement>(".board-control-add");
  }
  add!.click();
  await waitFor(() => Boolean(addDialog()), "the Add dialog did not open");
}
async function closeReader() {
  document
    .querySelector<HTMLButtonElement>(".board-reader .close-button")
    ?.click();
  await waitFor(() => !reader(), "the reader did not close");
}

async function fresh(elements: BoardElement[] = SEEDED) {
  root.render(<></>);
  await settle(500);
  saved = { ...emptyDocument(), elements: structuredClone(elements) };
  writes.length = 0;
  reads.length = 0;
  opened.length = 0;
  store = newStore();
  await store.refresh();
  mount();
  await waitFor(
    () => host.querySelectorAll(".board-element").length === elements.length,
    "the saved elements did not show",
  );
  await settle(300);
}

const scenarios: [string, () => Promise<void>][] = [
  [
    "cards",
    async () => {
      const kinds = [...host.querySelectorAll<HTMLElement>(".board-element")]
        .map((el) => el.dataset.elementKind)
        .sort();
      check(
        kinds.join() === "link,log,memory,memory",
        `each saved element has its card (${kinds})`,
      );
      check(
        Boolean(card("memory-notes")?.querySelector(".board-element-drawer")),
        "a memory card is a drawer with a label",
      );
      check(
        Boolean(card("link-pr")?.querySelector(".board-element-eyelet")) &&
          /example-org\/web-app#42/.test(card("link-pr")!.textContent ?? ""),
        `a pull request link names its ref (${card("link-pr")?.textContent})`,
      );
      check(
        /reviewer/.test(card("log-review")?.textContent ?? ""),
        "a log card names its agent",
      );
      check(
        /web-app · studio/.test(card("memory-notes")?.textContent ?? ""),
        `a project element names its project and host (${card("memory-notes")?.textContent})`,
      );
      const offline = card("memory-nightly")!;
      check(
        offline.classList.contains("board-element-offline") &&
          /offline/.test(offline.textContent ?? ""),
        "an element on an offline host says so",
      );
      check(
        card("memory-notes")?.getAttribute("aria-label") ===
          "Memory: Project memory",
        `a card names its kind for screen readers (${card("memory-notes")?.getAttribute("aria-label")})`,
      );
    },
  ],
  [
    "add lists every kind",
    async () => {
      await openAdd();
      const dialog = addDialog()!;
      const listed = [
        ...dialog.querySelectorAll<HTMLElement>("[data-kind]"),
      ].map((el) => el.dataset.kind);
      const registry = BOARD_ELEMENT_TYPES.map((entry) => entry.kind);
      check(
        listed.length === registry.length &&
          registry.every((kind) => listed.includes(kind)),
        `Add lists every registered kind once (${listed} vs ${registry})`,
      );
      check(
        [...dialog.querySelectorAll<HTMLElement>(".board-add-kind")]
          .map((el) => el.dataset.kind)
          .join() === "note,memory,log,document,link",
        "the kinds Board places come first, as buttons",
      );
      check(
        Boolean(button(dialog, "Open Work")) &&
          Boolean(button(dialog, "New workspace…")),
        "kinds that arrive on their own say where they come from",
      );
      button(dialog, "New workspace…")!.click();
      await waitFor(
        () => !addDialog() && Boolean(document.querySelector(".modal")),
        "New workspace… did not open the new-workspace dialog",
      );
      document
        .querySelector<HTMLButtonElement>(".modal [aria-label^='Close']")
        ?.click();
      await settle(100);
      check(writes.length === 0, "listing kinds writes no element");
    },
  ],
  [
    "add a link",
    async () => {
      await openAdd();
      addDialog()!
        .querySelector<HTMLButtonElement>('[data-kind="link"]')!
        .click();
      await waitFor(
        () => Boolean(addDialog()?.querySelector('input[type="url"]')),
        "the link form did not open",
      );
      const url =
        addDialog()!.querySelector<HTMLInputElement>('input[type="url"]')!;
      type(url, "ftp://files.example.com/plan.txt");
      await settle();
      button(addDialog()!, "Add")!.click();
      await waitFor(
        () => Boolean(addDialog()?.querySelector(".modal-error")),
        "a refused address showed no problem",
      );
      check(writes.length === 0, "a refused address is never sent");
      type(url, "https://github.com/example-org/web-app/issues/7");
      await settle();
      check(
        /Issue example-org\/web-app#7/.test(addDialog()!.textContent ?? ""),
        "the form names an issue link before saving",
      );
      button(addDialog()!, "Add")!.click();
      await waitFor(() => !addDialog(), "a valid link did not save");
      const put = writes[0];
      check(
        writes.length === 1 &&
          put?.op === "element.put" &&
          put.rev === undefined &&
          put.element.kind === "link" &&
          /^link-[0-9a-f]{16}$/.test(put.element.id),
        `one new element.put (${JSON.stringify(writes)})`,
      );
      await waitFor(
        () => host.querySelectorAll(".board-element").length === 5,
        "the new link has no card",
      );
    },
  ],
  [
    "add a doc",
    async () => {
      await openAdd();
      addDialog()!
        .querySelector<HTMLButtonElement>('[data-kind="document"]')!
        .click();
      await waitFor(
        () => Boolean(addDialog()?.querySelector("textarea")),
        "a doc does not start as a page written here",
      );
      type(addDialog()!.querySelector("textarea")!, "Release steps\n1. Tag");
      button(addDialog()!, "Add")!.click();
      await waitFor(() => !addDialog(), "the doc did not save");
      const doc = saved.elements!.find((entry) => entry.kind === "document");
      check(
        Boolean(doc) &&
          "text" in doc!.source &&
          doc!.source.text === "Release steps\n1. Tag",
        `the page is saved on Board (${JSON.stringify(doc)})`,
      );
      await waitFor(
        () => /Release steps/.test(card(doc!.id)?.textContent ?? ""),
        "the doc card shows its first lines",
      );
      await tap(card(doc!.id)!);
      await waitFor(
        () => /1\. Tag/.test(reader()?.textContent ?? ""),
        "the doc did not open",
      );
      check(
        lastRead()?.id === doc!.id &&
          lastRead()?.connection_generation === undefined,
        `a page written on Board reads without a host (${JSON.stringify(lastRead())})`,
      );
    },
  ],
  [
    "memory folder",
    async () => {
      await tap(card("memory-notes")!);
      await waitFor(
        () =>
          (reader()?.querySelectorAll(".board-reader-files li").length ?? 0) ===
          3,
        "the memory folder did not list its files",
      );
      check(
        JSON.stringify(reads[0]) ===
          JSON.stringify({ id: "memory-notes", connection_generation: 1 }),
        `the read names the host's generation (${JSON.stringify(reads[0])})`,
      );
      button(reader()!, "plan.md")!.click();
      await waitFor(
        () => /Ship the reader/.test(reader()?.textContent ?? ""),
        "a file in the folder did not open",
      );
      check(
        lastRead()?.path === "plan.md" &&
          lastRead()?.connection_generation === 1,
        `a file is read by its path inside the folder (${JSON.stringify(lastRead())})`,
      );
      reader()!
        .querySelector<HTMLButtonElement>('[aria-label="Back to the folder"]')!
        .click();
      await waitFor(
        () => Boolean(button(reader()!, "missing.md")),
        "Back did not return to the folder",
      );
      button(reader()!, "missing.md")!.click();
      await waitFor(
        () => /file is not there/.test(reader()?.textContent ?? ""),
        "a missing file did not say so",
      );
      check(
        Boolean(button(reader()!, "Try again")),
        "a missing file can be read again",
      );
      await closeReader();
      check(writes.length === 0, "reading writes nothing");
    },
  ],
  [
    "log turns",
    async () => {
      await tap(card("log-review")!);
      await waitFor(
        () =>
          (reader()?.querySelectorAll(".board-reader-turns li").length ?? 0) ===
          3,
        "the log did not show its turns",
      );
      const who = [
        ...reader()!.querySelectorAll<HTMLElement>(".board-reader-turns li"),
      ]
        .map((li) => li.dataset.who)
        .join();
      check(who === "you,tool,agent", `turns keep who said them (${who})`);
      button(reader()!, "Show raw")!.click();
      await waitFor(
        () => Boolean(reader()?.querySelector(".board-reader-text")),
        "Show raw did not show the saved lines",
      );
      check(
        Boolean(button(reader()!, "Show turns")),
        "raw lines can go back to turns",
      );
    },
  ],
  [
    "a log opens its agent's apartment",
    async () => {
      await tap(card("log-review")!);
      await waitFor(
        () => button(reader()!, "Open apartment")?.disabled === false,
        "the log of a finished agent offers no Open apartment",
      );
      button(reader()!, "Open apartment")!.click();
      await waitFor(() => !reader(), "Open apartment left the reader open");
      check(
        JSON.stringify(opened) ===
          JSON.stringify([["apartments", { resident: "r-studio-reviewer" }]]),
        `Open apartment opens the log's own host's resident (${JSON.stringify(opened)})`,
      );
    },
  ],
  [
    "a moved-out agent's log says so",
    async () => {
      await fresh([
        {
          ...SEEDED[1]!,
          source: {
            ...(SEEDED[1]!.source as object),
            apartment_id: "r-evicted",
          },
        } as BoardElement,
      ]);
      await tap(card("log-review")!);
      await waitFor(
        () => button(reader()!, "Open apartment")?.disabled === true,
        "a log whose agent left Apartments did not show the action off",
      );
      check(
        /no longer|does not live/.test(
          button(reader()!, "Open apartment")!.title,
        ),
        "the unavailable action says why",
      );
      check(
        /Two findings/.test(reader()!.textContent ?? ""),
        "the log still reads its saved file",
      );
    },
  ],
  [
    "a Library memory reads through the Library",
    async () => {
      libraryOnStudio();
      try {
        await fresh([...SEEDED, LIBRARY_MEMORY]);
        await tap(card("memory-build-notes")!);
        await waitFor(
          () =>
            /Library/.test(
              reader()?.querySelector("small")?.textContent ?? "",
            ) &&
            !/Reading…/.test(reader()?.textContent ?? "") &&
            Boolean(reader()?.querySelector(".board-reader-text")),
          "the Library memory did not show its text",
        );
        check(
          !reads.some((read) => read.id === "memory-build-notes"),
          "Board's own read is not used for a Library memory",
        );
        button(reader()!, "Open in Library")!.click();
        await waitFor(() => !reader(), "Open in Library left the reader open");
        check(
          JSON.stringify(opened) ===
            JSON.stringify([["library", { connectionId: "studio" }]]),
          `Open in Library opens the memory's host (${JSON.stringify(opened)})`,
        );
      } finally {
        setMemoryClientForTests(null);
      }
    },
  ],
  [
    "add a memory from the Library",
    async () => {
      libraryOnStudio();
      try {
        await openAdd();
        addDialog()!
          .querySelector<HTMLButtonElement>('[data-kind="memory"]')!
          .click();
        await waitFor(
          () =>
            addDialog()?.querySelector('[role="radio"][aria-checked="true"]')
              ?.textContent === "From the Library",
          "Memory did not start in the Library",
        );
        const memory = () =>
          [...addDialog()!.querySelectorAll("label")]
            .find((label) => label.textContent?.startsWith("Memory"))
            ?.querySelector("select");
        await waitFor(
          () => (memory()?.querySelectorAll("option").length ?? 0) > 1,
          "the Library's memories are not offered",
        );
        const notes = [...memory()!.querySelectorAll("option")].find((o) =>
          o.textContent?.startsWith("build-notes.md"),
        )!;
        memory()!.value = notes.value;
        memory()!.dispatchEvent(new Event("change", { bubbles: true }));
        await settle();
        button(addDialog()!, "Add")!.click();
        await waitFor(() => !addDialog(), "a Library memory did not save");
        const put = writes[0];
        check(
          put?.op === "element.put" &&
            put.element.kind === "memory" &&
            JSON.stringify(put.element.source) ===
              JSON.stringify({
                connection_id: "studio",
                memory_source_id: "fx-codex-memories",
                path: "build-notes.md",
              }),
          `the memory is saved as a Library reference (${JSON.stringify(put)})`,
        );
      } finally {
        setMemoryClientForTests(null);
      }
    },
  ],
  [
    "offline host",
    async () => {
      await tap(card("memory-nightly")!);
      await waitFor(
        () => /build-box is offline/.test(reader()?.textContent ?? ""),
        "an offline element did not say its host is offline",
      );
      check(
        !reads.some((read) => read.id === "memory-nightly"),
        "an offline element is never read through another connection",
      );
    },
  ],
  [
    "link opens in the browser",
    async () => {
      await tap(card("link-pr")!);
      await waitFor(
        () => Boolean(reader()?.querySelector("a.board-reader-open")),
        "the link has no Open link",
      );
      const open = reader()!.querySelector<HTMLAnchorElement>(
        "a.board-reader-open",
      )!;
      check(
        open.href === "https://github.com/example-org/web-app/pull/42" &&
          open.target === "_blank" &&
          open.rel.includes("noopener") &&
          open.rel.includes("noreferrer"),
        "Open link uses the browser, without an opener or referrer",
      );
    },
  ],
  [
    "edit keeps the place",
    async () => {
      await tap(card("link-pr")!);
      await waitFor(() => Boolean(reader()), "the link did not open");
      button(reader()!, "Edit")!.click();
      await waitFor(
        () => Boolean(addDialog()?.querySelector("input")),
        "Edit did not open the form",
      );
      const title = addDialog()!.querySelector<HTMLInputElement>("input")!;
      check(title.value === "Login fix", "Edit starts from the saved title");
      type(title, "Login fix (review)");
      button(addDialog()!, "Save")!.click();
      await waitFor(() => !addDialog(), "Save did not close the form");
      const put = writes[0];
      check(
        put?.op === "element.put" &&
          put.rev === 1 &&
          put.element.x === 240 &&
          put.element.y === 420 &&
          put.element.title === "Login fix (review)",
        `an edit is one put against the saved revision, in place (${JSON.stringify(put)})`,
      );
    },
  ],
  [
    "a stale draft never overwrites a newer page",
    async () => {
      const page: BoardElement = {
        id: "doc-plan",
        kind: "document",
        title: "Plan",
        x: 0,
        y: 600,
        rev: 1,
        source: { text: "Original plan" },
      };
      await fresh([...SEEDED, page]);
      await tap(card("doc-plan")!);
      await waitFor(() => Boolean(reader()), "the page did not open");
      button(reader()!, "Edit")!.click();
      await waitFor(
        () => Boolean(addDialog()?.querySelector("textarea")),
        "Edit did not open the page form",
      );
      // Another browser or the CLI saves rev 2 while this form is open.
      const remote = structuredClone(saved);
      remote.elements = remote.elements!.map((element) =>
        element.id === "doc-plan"
          ? ({ ...element, rev: 2, source: { text: "Newer plan" } } as never)
          : element,
      );
      remote.revision += 1;
      saved = remote;
      await store.refresh();
      await settle(100);
      const text = addDialog()!.querySelector("textarea")!;
      check(text.value === "Original plan", "the open draft keeps its text");
      type(text, "My draft");
      button(addDialog()!, "Save")!.click();
      await waitFor(
        () => Boolean(addDialog()?.querySelector('[role="alert"]')),
        "a stale save showed no problem",
      );
      const put = writes[0];
      check(
        put?.op === "element.put" && put.rev === 1,
        `the draft saves against the rev it was opened from (${JSON.stringify(put)})`,
      );
      const now = saved.elements!.find((element) => element.id === "doc-plan");
      check(
        now?.rev === 2 &&
          (now.source as { text: string }).text === "Newer plan",
        "the newer page stays",
      );
      check(
        addDialog()!.querySelector("textarea")!.value === "My draft" &&
          /changed somewhere else/.test(
            addDialog()!.querySelector('[role="alert"]')!.textContent ?? "",
          ),
        "the form stays open with the draft and says why",
      );
    },
  ],
  [
    "drag saves the place",
    async () => {
      const el = card("log-review")!;
      const from = centre(el);
      pointer(el, "pointerdown", from.x, from.y);
      for (let step = 1; step <= 8; step++) {
        pointer(el, "pointermove", from.x + step * 10, from.y + step * 5);
        await settle(16);
      }
      await settle(100);
      pointer(el, "pointerup", from.x + 80, from.y + 40);
      await waitFor(() => writes.length > 0, "a dragged element did not save");
      const put = writes[0];
      check(
        put?.op === "element.put" &&
          put.element.id === "log-review" &&
          put.rev === 1 &&
          (put.element.x !== 0 || put.element.y !== 420) &&
          Number.isInteger(put.element.x) &&
          Number.isInteger(put.element.y),
        `a drag saves the new place against the saved revision (${JSON.stringify(put)})`,
      );
      check(!reader(), "a drag does not open the element");
    },
  ],
  [
    "remove",
    async () => {
      await tap(card("memory-notes")!);
      await waitFor(() => Boolean(reader()), "the memory did not open");
      reader()!
        .querySelector<HTMLButtonElement>(".board-reader-remove")!
        .click();
      await waitFor(() => !card("memory-notes"), "Remove left the card");
      check(
        JSON.stringify(writes) ===
          JSON.stringify([
            { op: "element.delete", id: "memory-notes", rev: 1 },
          ]),
        `Remove deletes against the saved revision (${JSON.stringify(writes)})`,
      );
      check(!reader(), "Remove closes the reader");
      card("log-review")!.focus();
      card("log-review")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
      );
      await waitFor(
        () => !card("log-review"),
        "Delete on a card did not remove it",
      );
    },
  ],
];

async function run() {
  for (const [name, scenario] of scenarios) {
    current = name;
    try {
      await fresh();
      await scenario();
    } catch (error) {
      failures.push(`${name}: ${String(error)}`);
    }
  }
  current = "";
}

/** One screen for captures. */
async function preview(shot: string) {
  await fresh([
    ...SEEDED,
    {
      id: "doc-release",
      kind: "document",
      title: "Release steps",
      x: 0,
      y: 600,
      rev: 1,
      source: {
        text: "1. Tag the release\n2. Build every channel\n3. Announce",
      },
    },
  ]);
  document
    .querySelector<HTMLButtonElement>('[aria-label="Fit everything"]')
    ?.click();
  for (let frame = 0; frame < 90; frame += 1) await clock.advance(16);
  if (shot === "add") await openAdd();
  const ids: Record<string, string> = {
    memory: "memory-notes",
    log: "log-review",
    link: "link-pr",
    offline: "memory-nightly",
  };
  if (ids[shot]) {
    await tap(card(ids[shot]!)!);
    await waitFor(
      () =>
        Boolean(reader()) &&
        !/Reading…/.test(
          reader()?.querySelector(".board-reader-body")?.textContent ?? "",
        ),
      "the reader did not open",
    );
  }
  for (let frame = 0; frame < 20; frame += 1) await clock.advance(16);
}

void (mode === "preview" ? preview(params.get("shot") ?? "board") : run())
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
  );
