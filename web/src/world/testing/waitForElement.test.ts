import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { waitForElement } from "./waitForElement";

const browser = new Window();
const original = globalThis.MutationObserver;
globalThis.MutationObserver =
  browser.MutationObserver as unknown as typeof MutationObserver;
afterEach(() => {
  browser.document.body.innerHTML = "";
});
process.on("exit", () => {
  globalThis.MutationObserver = original;
});

const card = (name: string) => () =>
  [...browser.document.querySelectorAll(".town-room-card")].find((element) =>
    element.textContent?.includes(name),
  ) as Element | undefined;

test("a card that is already mounted resolves at once", async () => {
  browser.document.body.innerHTML =
    '<button class="town-room-card">all-protected-room</button>';
  const found = await waitForElement(
    browser.document.body as unknown as Node,
    card("all-protected-room"),
    "never mounted",
  );
  expect(found.textContent).toBe("all-protected-room");
});

test("a card mounted after the wait starts resolves on that commit", async () => {
  const waiting = waitForElement(
    browser.document.body as unknown as Node,
    card("all-protected-room"),
    "never mounted",
  );
  // Another room's card does not satisfy the wait.
  browser.document.body.insertAdjacentHTML(
    "beforeend",
    '<button class="town-room-card">fold-room</button>',
  );
  browser.document.body.insertAdjacentHTML(
    "beforeend",
    '<button class="town-room-card">all-protected-room</button>',
  );
  expect((await waiting).textContent).toBe("all-protected-room");
});

test("a card that never mounts rejects with the message", async () => {
  browser.document.body.innerHTML =
    '<button class="town-room-card">fold-room</button>';
  await expect(
    waitForElement(
      browser.document.body as unknown as Node,
      card("all-protected-room"),
      "the all-protected room overview card never mounted",
      1,
    ),
  ).rejects.toThrow("the all-protected room overview card never mounted");
});
