import { clock } from "../../testing/installRunningTestClock";
import { createRoot, type Root } from "react-dom/client";
import "../../styles/tokens.css";
import "../../styles/base.css";
import {
  MEMORY_LIMITS,
  type MemoryAction,
  type MemoryCatalog,
  type MemoryTarget,
} from "../../../../shared/memory";
import { MemoryLibrary } from "./MemoryLibrary";
import type { MemoryLibraryRequest } from "./memoryEvents";
import {
  type MemoryClient,
  publishMemoryHosts,
  setMemoryClientForTests,
} from "./memoryClient";

/*
 * The Library's (#1027) ordering and ownership rules, against a scripted
 * client whose replies the checks release by hand:
 * - an uncertain save keeps the draft on the revision it started from, so a
 *   second Save cannot overwrite an edit it never showed; a save that did
 *   land is recognised and closes the editor;
 * - a named host that disconnects becomes unavailable, never another host's
 *   agent with the same native ID;
 * - a search still under way when the reader or host changes never shows
 *   its matches, and Search works again.
 * Limits: one desktop viewport, a scripted client rather than the service
 * (the service's own refusals are covered by server/src/memory tests).
 * Every name is invented.
 */

const failures: string[] = [];
const check = (condition: unknown, message: string) => {
  if (!condition) failures.push(message);
};

type Call = {
  action: MemoryAction;
  target: MemoryTarget;
  params: Record<string, unknown>;
};
type Held = Call & { release(): void; fail(error: Error): void };

const A: MemoryTarget = { connection_id: "host-a", connection_generation: 1 };
const B: MemoryTarget = { connection_id: "host-b", connection_generation: 1 };
const names = { p1: "alpha-agent", p2: "beta-agent" };

/** One synthetic note per host; `external` edits it behind the page. */
const files = new Map<string, { content: string; revision: number }>();
const fileKey = (target: MemoryTarget) => target.connection_id;
function external(target: MemoryTarget, content: string) {
  const file = files.get(fileKey(target))!;
  file.content = content;
  file.revision += 1;
}

const calls: Call[] = [];
const held: Held[] = [];
/** Actions whose replies wait for a check to release them. */
const hold = new Set<MemoryAction>();
/** The next update's outcome: run, or run and then report uncertain. */
let nextUpdate: "ok" | "uncertain-landed" | "uncertain-lost" = "ok";

function catalog(target: MemoryTarget): MemoryCatalog {
  const file = files.get(fileKey(target))!;
  const now = Date.now();
  return {
    ...target,
    observed_at: now,
    projects: [{ id: "w1", label: "example-app", path: "/workspace/app" }],
    agents: ["p1", "p2"].map((id) => ({
      id,
      project_id: "w1",
      harness: "claude",
      path: "/workspace/app",
    })),
    sources: [
      {
        id: "notes",
        harnesses: ["claude"],
        kind: "memory",
        scope: "project",
        path: `/home/example/${target.connection_id}/memory`,
        shape: "directory",
        load: "startup-candidate",
        description: `Notes on ${target.connection_id}`,
        details: {},
        project_ids: ["w1"],
        agent_ids: ["p1", "p2"],
        state: "available",
      },
    ],
    entries: [
      {
        id: "e1",
        source_id: "notes",
        path: "note.md",
        size: file.content.length,
        modified_at: now,
        age_ms: 0,
        stale: false,
        state: "available",
        load: "startup-candidate",
        harness_loads: { claude: { mode: "startup-candidate" } },
      },
    ],
    unsupported: [],
    warnings: [],
    truncated: false,
    limits: MEMORY_LIMITS,
  };
}

function answer(call: Call): unknown {
  const file = files.get(fileKey(call.target))!;
  const { action, params } = call;
  if (action === "list") return catalog(call.target);
  if (action === "read")
    return {
      ...call.target,
      source_id: "notes",
      path: "note.md",
      content: file.content,
      revision: `r${file.revision}`,
      size: file.content.length,
      modified_at: Date.now(),
    };
  if (action === "search") {
    const entry = catalog(call.target).entries[0]!;
    return {
      ...call.target,
      query: params.query,
      matches: [{ entry, line: 1, excerpt: `found for ${params.agent_id}` }],
      scanned_bytes: 10,
      skipped: 0,
      truncated: false,
    };
  }
  if (action === "update") {
    if (params.revision !== `r${file.revision}`)
      throw new Error("conflict: The file changed since you opened it");
    const outcome = nextUpdate;
    nextUpdate = "ok";
    if (outcome === "uncertain-lost") {
      // The write never landed, and another editor changed the file.
      external(call.target, "EXTERNAL");
      throw new Error("uncertain: The host stopped answering");
    }
    file.content = String(params.content);
    file.revision += 1;
    if (outcome === "uncertain-landed")
      throw new Error("uncertain: The host stopped answering");
    return {
      ...call.target,
      source_id: "notes",
      path: "note.md",
      status: "updated",
      revision: `r${file.revision}`,
    };
  }
  throw new Error(`invalid: ${action} is not scripted`);
}

function call(
  action: MemoryAction,
  target: MemoryTarget,
  params: Record<string, unknown> = {},
): Promise<never> {
  const entry: Call = { action, target, params };
  calls.push(entry);
  return new Promise((resolve, reject) => {
    const settle = () => {
      try {
        resolve(answer(entry) as never);
      } catch (error) {
        reject(error);
      }
    };
    if (hold.has(action))
      held.push({ ...entry, release: settle, fail: reject });
    else void clock.advance(5).then(settle);
  });
}

const client: MemoryClient = {
  list: (target) => call("list", target),
  search: (target, query, filter = {}) =>
    call("search", target, { query, ...filter }),
  read: (target) => call("read", target),
  create: (target) => call("create", target),
  update: (target, _source, _path, revision, content) =>
    call("update", target, { revision, content }),
  remove: (target) => call("delete", target),
};

const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T & HTMLElement>(selector);
const $$ = (selector: string) => [
  ...document.querySelectorAll<HTMLElement>(selector),
];
const byText = (selector: string, text: string | RegExp) =>
  $$(selector).find((el) =>
    typeof text === "string"
      ? el.textContent?.includes(text)
      : text.test(el.textContent ?? ""),
  );
const content = () => $(".memory-content")?.textContent ?? "";
const tick = () => clock.advance(60);

async function waitFor<T>(
  read: () => T,
  message: string,
): Promise<NonNullable<T>> {
  let value: T;
  await clock.until(() => Boolean((value = read())), message, 6_000);
  return value! as NonNullable<T>;
}

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(el),
    "value",
  )!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const mount = document.createElement("div");
document.body.append(mount);
let root: Root | null = null;

/** A fresh Library over hosts A and B with untouched notes. */
async function open(request: MemoryLibraryRequest) {
  root?.unmount();
  setMemoryClientForTests(client);
  files.set("host-a", { content: "ORIGINAL", revision: 1 });
  files.set("host-b", { content: "B NOTE", revision: 1 });
  calls.length = 0;
  held.length = 0;
  hold.clear();
  publishMemoryHosts([
    { ...A, label: "Host A", names },
    { ...B, label: "Host B", names },
  ]);
  root = createRoot(mount);
  root.render(<MemoryLibrary request={request} onClose={() => {}} />);
  await waitFor(() => $(".memory-book-row"), "the shelves never showed");
}

async function openNote() {
  $(".memory-book-row")!.click();
  await waitFor(
    () => content() && !$(".memory-content[aria-busy=true]"),
    "the note never read",
  );
}

async function edit(text: string) {
  byText(".memory-book .memory-actions button", "Edit")!.click();
  type(
    await waitFor(() => $<HTMLTextAreaElement>(".memory-text"), "no editor"),
    text,
  );
}

const save = () =>
  byText(".memory-book .memory-actions button", /^Save$/)!.click();
const updates = () =>
  calls.filter((c) => c.action === "update").map((c) => c.params.revision);

async function uncertainLost() {
  await open({ connectionId: "host-a" });
  await openNote();
  await edit("MINE");
  nextUpdate = "uncertain-lost";
  save();
  await waitFor(
    () => byText(".memory-notice", "doesn't match your text"),
    "an uncertain save that did not land gave no reconcile notice",
  );
  check(
    $<HTMLTextAreaElement>(".memory-text")?.value === "MINE",
    "the uncertain save lost the draft",
  );
  save();
  await waitFor(
    () => byText(".memory-notice", "changed on the host"),
    "a second Save after the uncertain one did not conflict",
  );
  check(
    JSON.stringify(updates()) === '["r1","r1"]',
    `saves sent revisions ${JSON.stringify(updates())}, not the draft's r1 twice`,
  );
  check(
    files.get("host-a")!.content === "EXTERNAL",
    "the other editor's change was overwritten",
  );
  byText(".memory-notice button", "Load latest")!.click();
  await waitFor(
    () => content().includes("EXTERNAL"),
    "Load latest never showed the other editor's text",
  );
}

async function uncertainLanded() {
  await open({ connectionId: "host-a" });
  await openNote();
  await edit("MINE");
  nextUpdate = "uncertain-landed";
  save();
  await waitFor(
    () => byText(".memory-notice", "it has your text"),
    "an uncertain save that landed was not recognised",
  );
  check(!$(".memory-text"), "the editor stayed open after the save landed");
  check(content().includes("MINE"), "the landed text is not shown");
}

async function hostGoes() {
  await open({ connectionId: "host-a", agentId: "p1" });
  publishMemoryHosts([{ ...B, label: "Host B", names }]);
  await waitFor(
    () => byText(".memory-gone", "Host A is no longer connected"),
    "losing the named host did not say so",
  );
  await tick();
  const lists = calls
    .filter((c) => c.action === "list")
    .map((c) => c.target.connection_id);
  check(
    JSON.stringify(lists) === '["host-a"]',
    `losing host A listed ${JSON.stringify(lists)}`,
  );
  check(!$(".memory-book-row"), "shelves still show for a lost host");
  check(
    !$(".memory-host select"),
    "a host picker shows another host as chosen",
  );
  byText(".memory-gone button", "Open Host B")!.click();
  await waitFor(
    () => byText(".memory-book-row", "note.md") && $(".memory-host-name"),
    "Open Host B never read host B",
  );
  check(
    $('.memory-reader[aria-pressed="true"]')?.textContent?.includes(
      "Everything",
    ),
    "opening host B kept host A's agent as the reader",
  );
}

async function search(words: string) {
  type($<HTMLInputElement>('input[aria-label="Search memory"]')!, words);
  $<HTMLFormElement>(".memory-search")!.requestSubmit();
  await waitFor(
    () => held.find((c) => c.action === "search"),
    "the search never started",
  );
}
const searchButton = () => $<HTMLButtonElement>(".memory-search button")!;

async function readerChangesMidSearch() {
  await open({ connectionId: "host-a", agentId: "p1" });
  hold.add("search");
  await search("note");
  byText(".memory-reader", "beta-agent")!.click();
  await tick();
  const pending = held.find((c) => c.action === "search")!;
  check(pending.params.agent_id === "p1", "the search did not name p1");
  pending.release();
  await tick();
  check(!$(".memory-match"), "p1's late matches showed with beta-agent chosen");
  check(
    !searchButton().disabled,
    "Search stayed disabled after a reader change",
  );
}

async function hostChangesMidSearch() {
  await open({ connectionId: "host-a" });
  hold.add("search");
  await search("note");
  const select = $<HTMLSelectElement>(".memory-host select")!;
  select.value = "host-b";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await waitFor(
    () =>
      calls.some(
        (c) => c.action === "list" && c.target.connection_id === "host-b",
      ),
    "choosing host B never read it",
  );
  check(!searchButton().disabled, "Search stayed disabled after a host change");
  held.find((c) => c.action === "search")!.release();
  await tick();
  check(!$(".memory-match"), "host A's late matches showed on host B");
  check(!searchButton().disabled, "Search disabled after the old one finished");
}

async function run() {
  for (const [label, scenario] of [
    ["uncertain save, lost", uncertainLost],
    ["uncertain save, landed", uncertainLanded],
    ["named host disconnects", hostGoes],
    ["reader changes mid-search", readerChangesMidSearch],
    ["host changes mid-search", hostChangesMidSearch],
  ] as const) {
    try {
      await scenario();
    } catch (error) {
      failures.push(`${label}: ${String(error)}`);
    }
  }
}

run()
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", {
      method: "POST",
      body: JSON.stringify(failures.slice(0, 30)),
    }),
  );
