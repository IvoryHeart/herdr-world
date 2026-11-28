import { clock as fixtureTime } from "../testing/installTestClock";
import { flushSync } from "react-dom";
import { TownLibrary } from "../town/TownLibrary";
import type { TownLayout } from "../town/townLayout";
import { AgentMemoryLink } from "./AgentMemoryLink";
import { createRoot } from "react-dom/client";
import "../../styles/tokens.css";
import "../../styles/base.css";
import { MemoryLibrary } from "./MemoryLibrary";
import { memoryFixtureTouch, setMemoryFixtureForTests } from "./memoryFixture";

/*
 * The Library (#1027) against its synthetic host (the `?memoryFixture`
 * switch): browse what an agent loads, read a book, edit and save, a save
 * that conflicts, the delete confirmation, a new note, the first note in a
 * missing memory folder and search, on a laptop and a phone. Every path and name is invented.
 */

const phone = innerWidth < 640;
const failures: string[] = [];
const check = (condition: unknown, message: string) => {
  if (!condition) failures.push(`${phone ? "phone" : "desktop"}: ${message}`);
};

setMemoryFixtureForTests(true);
let closed = 0;
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
root.render(
  <MemoryLibrary
    request={{ connectionId: "memory-fixture", agentId: "p1" }}
    onClose={() => {
      closed += 1;
    }}
  />,
);

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
const shown = (el: Element | null | undefined) =>
  Boolean(el && (el as HTMLElement).getClientRects().length);

async function waitFor<T>(
  read: () => T,
  message: string,
): Promise<NonNullable<T>> {
  const until = performance.now() + 8_000;
  for (;;) {
    const value = read();
    if (value) return value as NonNullable<T>;
    if (performance.now() > until) throw new Error(message);
    await fixtureTime.advance(25);
  }
}

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(el),
    "value",
  )!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const dialog = () => $(".memory-library")!;
const book = (name: string) => byText(".memory-book-row", name);
const content = () => $(".memory-content")?.textContent ?? "";

/** Nothing spills sideways once the open and shelve motions have ended. */
async function fits(label: string) {
  await Promise.all(
    document
      .getAnimations()
      .filter((a) => a.effect?.getTiming().iterations !== Infinity)
      .map((a) => a.finished.catch(() => {})),
  );
  const box = dialog().getBoundingClientRect();
  check(
    box.left >= -0.5 && box.right <= innerWidth + 0.5,
    `${label}: the dialog spans ${box.left}–${box.right} in ${innerWidth}px`,
  );
  for (const pane of $$(".memory-middle, .memory-right, .memory-readers"))
    if (shown(pane) && pane.scrollWidth > pane.clientWidth + 1) {
      const edge = pane.getBoundingClientRect().left + pane.clientWidth;
      const wide = [...pane.querySelectorAll<HTMLElement>("*")].find(
        (el) => el.getBoundingClientRect().right > edge + 1,
      );
      failures.push(
        `${label}: ${pane.className} scrolls sideways (${pane.scrollWidth} > ${pane.clientWidth}), first past its edge: ${wide?.tagName}.${wide?.className}`,
      );
    }
}

async function backToShelves() {
  if (!phone) return;
  $(".memory-book .memory-back")!.click();
  await waitFor(
    () => dialog().dataset.pane === "shelves",
    "Back never left the book",
  );
}

async function run() {
  // Opening focuses the dialog, so Escape and Tab start inside it.
  await waitFor(() => book("testing.md"), "the shelves never showed");
  check(
    dialog().contains(document.activeElement),
    "the Library did not take focus",
  );
  // An agent reader leads with what it would load next time.
  const pressed = $('.memory-reader[aria-pressed="true"]');
  if (phone) {
    check(!shown($(".memory-readers")), "the readers list shows on a phone");
    const select = $<HTMLSelectElement>(".memory-reader-select select")!;
    check(
      select.value === "agent:p1",
      `the reader picker shows ${select.value}`,
    );
  } else
    check(
      pressed?.textContent?.includes("web-builder"),
      "web-builder is not the reader",
    );
  const load = $(".memory-agent-load")?.textContent ?? "";
  check(/4\s*at start/.test(load), `load card says "${load}"`);
  check(/2\s*when needed/.test(load), `load card says "${load}"`);
  check(
    byText(".memory-book-row", "AGENTS.md")?.textContent?.includes(
      "Hidden by another file",
    ),
    "AGENTS.md does not read as hidden for Claude",
  );
  check(
    byText(".memory-shelf", "reviewer")?.textContent?.includes(
      "leaves its home",
    ),
    "the refused shelf gives no reason",
  );
  check(
    book("release.md")?.classList.contains("is-stale"),
    "the 61-day-old note is not stale",
  );
  await fits("shelves");

  // Read a book.
  book("testing.md")!.click();
  await waitFor(
    () => content().includes("Browser tests need"),
    "the book never read",
  );
  check(
    dialog().dataset.pane === "book",
    "opening a book left the shelves pane",
  );
  if (phone) {
    check(
      !shown($(".memory-middle")),
      "the shelves still show beside a phone's book",
    );
    check(shown($(".memory-book .memory-back")), "a phone's book has no Back");
  } else {
    check(
      shown($(".memory-middle")) && shown($(".memory-right")),
      "desktop hides a pane",
    );
    check(!shown($(".memory-book .memory-back")), "desktop shows Back");
  }
  check(
    $(".memory-book-readers")?.textContent?.includes("web-builder"),
    "the book does not say who reads it",
  );
  await fits("book");

  // Edit and save.
  byText(".memory-book .memory-actions button", "Edit")!.click();
  const area = await waitFor(
    () => $<HTMLTextAreaElement>(".memory-text"),
    "Edit opened no editor",
  );
  type(area, "# Testing\n\nRun the browser lane before pushing.\n");
  byText(".memory-book .memory-actions button", "Save")!.click();
  await waitFor(
    () =>
      byText(".memory-notice", "Saved.") && content().includes("browser lane"),
    "the save never landed",
  );

  // A save over someone else's change conflicts and keeps your text.
  byText(".memory-book .memory-actions button", "Edit")!.click();
  type(
    await waitFor(() => $<HTMLTextAreaElement>(".memory-text"), "no editor"),
    "mine",
  );
  memoryFixtureTouch("fx-web-memory", "testing.md", "# Testing\n\nTheirs.\n");
  byText(".memory-book .memory-actions button", "Save")!.click();
  await waitFor(
    () => byText(".memory-notice", "changed on the host"),
    "no conflict notice",
  );
  check(
    $<HTMLTextAreaElement>(".memory-text")?.value === "mine",
    "the conflict lost your text",
  );
  byText(".memory-notice button", "Load latest")!.click();
  await waitFor(
    () => content().includes("Theirs."),
    "Load latest never read theirs",
  );

  // The switch's uncertain write keeps your text on the revision you read,
  // so saving again conflicts with the edit made elsewhere.
  byText(".memory-book .memory-actions button", "Edit")!.click();
  type(
    await waitFor(() => $<HTMLTextAreaElement>(".memory-text"), "no editor"),
    "lost [uncertain]",
  );
  byText(".memory-book .memory-actions button", "Save")!.click();
  await waitFor(
    () => byText(".memory-notice", "doesn't match your text"),
    "an uncertain save gave no reconcile notice",
  );
  check(
    $<HTMLTextAreaElement>(".memory-text")?.value === "lost [uncertain]",
    "the uncertain save lost your text",
  );
  byText(".memory-book .memory-actions button", "Save")!.click();
  await waitFor(
    () => byText(".memory-notice", "changed on the host"),
    "saving again after an uncertain save did not conflict",
  );
  byText(".memory-notice button", "Load latest")!.click();
  await waitFor(
    () => content().includes("Edited elsewhere"),
    "Load latest never read the edit made elsewhere",
  );

  // Delete asks first; Keep it keeps it.
  byText(".memory-book .memory-actions button", "Delete")!.click();
  const confirm = await waitFor(
    () => $('[role="alertdialog"]'),
    "Delete did not ask",
  );
  check(
    document.activeElement?.textContent === "Delete",
    "the confirmation's Delete is not focused",
  );
  check(
    confirm.textContent?.includes("MEMORY.md still lists it"),
    "no index hint on a topic",
  );
  byText('[role="alertdialog"] button', "Keep it")!.click();
  await waitFor(
    () => !$('[role="alertdialog"]'),
    "Keep it did not close the question",
  );
  check(content().includes("Edited elsewhere"), "Keep it lost the book");
  byText(".memory-book .memory-actions button", "Delete")!.click();
  await waitFor(() => $('[role="alertdialog"]'), "Delete did not ask again");
  byText('[role="alertdialog"] button', /^Delete$/)!.click();
  await waitFor(
    () => !book("testing.md") && !$(".memory-content"),
    "the deleted book stayed",
  );
  if (phone)
    check(
      dialog().dataset.pane === "shelves",
      "a phone stayed on a deleted book",
    );

  // A new note on Claude's memory shelf.
  $('button[aria-label^="Add a note"][aria-label$="web-app/memory"]')!.click();
  const name = await waitFor(
    () => $<HTMLInputElement>('input[aria-label="Note name"]'),
    "+ opened no name",
  );
  type(name, "decisions");
  type($<HTMLTextAreaElement>(".memory-text")!, "# Decisions\n\nShip small.\n");
  check(
    byText(".memory-editor", "Add it to MEMORY.md too"),
    "no hint that Claude needs the index",
  );
  byText(".memory-book .memory-actions button", "Create")!.click();
  await waitFor(
    () => book("decisions.md") && content().includes("Ship small."),
    "the new note never opened",
  );
  await backToShelves();

  // Search what this agent reads.
  type($<HTMLInputElement>('input[aria-label="Search memory"]')!, "release");
  $<HTMLFormElement>(".memory-search")!.requestSubmit();
  const match = await waitFor(
    () =>
      $$(".memory-match").find((el) =>
        el
          .querySelector(".memory-book-name")
          ?.textContent?.startsWith("release.md:"),
      ),
    "search found nothing in release.md",
  );
  check(byText(".memory-match", "MEMORY.md"), "search missed the index's line");
  check(
    !byText(".memory-match", "old-hosting.md"),
    "search reached files this agent does not read",
  );
  match.click();
  await waitFor(
    () => content().includes("Tag only after"),
    "a match never opened",
  );
  await backToShelves();
  if ($(".memory-search-head"))
    byText(".memory-search-head button", "Back to shelves")!.click();

  // Another agent: a missing file to create, and everything.
  if (phone) {
    const select = $<HTMLSelectElement>(".memory-reader-select select")!;
    select.value = "agent:p3";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  } else byText(".memory-reader", "docs-writer")!.click();
  await waitFor(
    () => byText(".memory-create", "Create AGENTS.md"),
    "no Create for a missing file",
  );
  check(
    !book("style.md") && !book("MEMORY.md"),
    "docs-writer sees web-app's shelves",
  );
  await fits("another reader");

  // A fresh project's missing memory folder takes its first note.
  byText(".memory-create", "Add the first note")!.click();
  type(
    await waitFor(
      () => $<HTMLInputElement>('input[aria-label="Note name"]'),
      "Add the first note opened no name",
    ),
    "first",
  );
  type($<HTMLTextAreaElement>(".memory-text")!, "# First\n\nHello.\n");
  byText(".memory-book .memory-actions button", "Create")!.click();
  await waitFor(
    () => book("first.md") && content().includes("Hello."),
    "the first note in a missing folder never opened",
  );
  await backToShelves();

  // The new documented harness has its own project and user instructions.
  if (phone) {
    const select = $<HTMLSelectElement>(".memory-reader-select select")!;
    check(
      ![...select.options].some((option) =>
        /no-memory-app|helper/.test(option.text),
      ),
      "unsupported readers have a zero-count entry",
    );
    select.value = "agent:p5";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    check(
      !byText(".memory-reader", "no-memory-app") &&
        !byText(".memory-reader", "helper"),
      "unsupported readers have a zero-count entry",
    );
    byText(".memory-reader", "opencode-builder")!.click();
  }
  await waitFor(
    () => $(".memory-agent-load")?.textContent?.includes("opencode-builder"),
    "OpenCode reader never opened",
  );
  check(
    /2\s*at start/.test($(".memory-agent-load")!.textContent ?? ""),
    "OpenCode instructions do not load at start",
  );
  check(
    $$(".memory-book-row").length === 2,
    "OpenCode lacks project and user AGENTS.md",
  );
  check(
    byText(".memory-shelf", "OpenCode project instructions") &&
      byText(".memory-shelf", "OpenCode user instructions"),
    "OpenCode shelves lack descriptions",
  );
  await fits("OpenCode reader");

  // Escape closes the Library.
  const search = $<HTMLInputElement>('input[aria-label="Search memory"]')!;
  search.focus();
  search.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  check(closed === 1, `Escape closed ${closed} times`);

  // The no-capable-host preview state has neither desktop nor phone sign.
  flushSync(() => root.render(null));
  setMemoryFixtureForTests(true, true);
  flushSync(() =>
    root.render(
      <>
        <TownLibrary layout={{} as TownLayout} />
        <AgentMemoryLink
          connectionId="memory-fixture"
          agentId="p4"
          harness="letta"
        />
      </>,
    ),
  );
  check(!$(".town-library-sign"), "unsupported-only host has a Library sign");
  check(
    !host.textContent?.includes("Memory"),
    "unsupported agent has a Memory entry",
  );
}

run()
  .catch((error) =>
    failures.push(`${phone ? "phone" : "desktop"}: ${String(error)}`),
  )
  .finally(() =>
    fetch("/result", {
      method: "POST",
      body: JSON.stringify(failures.slice(0, 30)),
    }),
  );
