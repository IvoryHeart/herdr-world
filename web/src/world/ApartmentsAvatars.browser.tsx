import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { STARTER_PROFILES } from "../../../shared/agentProfile";
import { bridge } from "../api";
import { ApartmentsDialog } from "./apartments/ApartmentsDialog";
import { setApartmentsClient } from "./apartments/useApartments";
import { fixtureHost, fixtureWorld } from "./board/boardFixture";
import { fixtureApartmentsClient } from "./testing/apartmentsFixture";
import "../styles/tokens.css";
import "../styles/base.css";
import "./world.css";

// Apartments' residents with their avatars, real CSS in real Chrome: one
// resident per way an avatar is found (apartments/residentLook.ts), on a
// phone and a desktop. Synthetic residents and starter profiles only.

const failures: string[] = [];
const check = (condition: unknown, message: string) => {
  if (!condition) failures.push(message);
};
const parameters = new URLSearchParams(location.search);
const opened = parameters.get("open");

Object.assign(bridge, {
  call: async (method: string) => {
    if (method === "world.profiles.get")
      return {
        version: 1,
        revision: 1,
        profiles: STARTER_PROFILES,
        assignments: [],
        chimes: {},
        town_master: null,
      };
    throw new Error(`Unavailable in the Apartments fixture: ${method}`);
  },
  onControl: () => () => undefined,
  onStatus: () => () => undefined,
});
setApartmentsClient(fixtureApartmentsClient(Date.now()));

const frame = () =>
  new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
async function until(test: () => boolean, what: string) {
  for (let i = 0; i < 200; i += 1) {
    if (test()) return;
    await frame();
  }
  throw new Error(`timed out: ${what}`);
}

/** Painted pixels: the sprite drew a character, not a blank canvas. */
function painted(canvas: HTMLCanvasElement | null) {
  if (!canvas || !canvas.width) return 0;
  const data = canvas
    .getContext("2d")!
    .getImageData(0, 0, canvas.width, canvas.height).data;
  let count = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) count += 1;
  return count;
}
const inside = (inner: DOMRect, outer: DOMRect) =>
  inner.left >= outer.left - 0.5 &&
  inner.right <= outer.right + 0.5 &&
  inner.top >= outer.top - 0.5 &&
  inner.bottom <= outer.bottom + 0.5;

// Where each resident's avatar comes from, with the starter profiles loaded.
const EXPECTED: Record<string, { source: string; title: string }> = {
  ada: { source: "own", title: "" },
  grace: { source: "own", title: "" },
  linus: { source: "own", title: "" },
  hopper: {
    source: "harness",
    title: "Nearest avatar: the Reviewer profile, same harness",
  },
  lovelace: { source: "profile", title: "Avatar from its profile Reviewer" },
  turing: { source: "default", title: "World's default avatar" },
};

function checkAvatar(avatar: HTMLElement, name: string, large: boolean) {
  const box = avatar.getBoundingClientRect();
  const sprite = avatar.querySelector<HTMLCanvasElement>("canvas");
  check(painted(sprite) > 40, `${name}: its avatar is blank`);
  check(
    sprite && inside(sprite.getBoundingClientRect(), box),
    `${name}: the character spills out of its tile`,
  );
  const icon = avatar.querySelector<HTMLElement>(".apartments-avatar-harness");
  const iconBox = icon?.getBoundingClientRect();
  check(
    iconBox && iconBox.width >= 10 && iconBox.height >= 10,
    `${name}: its harness icon is missing`,
  );
  check(
    getComputedStyle(avatar).backgroundColor !== "rgba(0, 0, 0, 0)",
    `${name}: its tile has no colour`,
  );
  check(
    Math.abs(box.width - (large ? 54 : 36)) < 1,
    `${name}: tile is ${box.width}px wide`,
  );
}

async function run() {
  const host = document.createElement("div");
  document.body.append(host);
  const world = fixtureWorld([
    fixtureHost("local", [{ label: "alpha", tabs: [] }]),
  ]);
  createRoot(host).render(
    createElement(ApartmentsDialog, {
      world,
      onOpen: () => undefined,
      onClose: () => undefined,
    }),
  );
  const rows = () => [
    ...document.querySelectorAll<HTMLElement>("button.apartments-row"),
  ];
  // Six residents, and the profiles have loaded (lovelace reads its own).
  await until(
    () =>
      rows().length === 6 &&
      rows()[4]?.querySelector<HTMLElement>(".apartments-avatar")?.dataset
        .avatarSource === "profile",
    "residents and profiles",
  );
  await frame();
  const dialog = document.querySelector<HTMLElement>(".apartments-dialog")!;
  for (const row of rows()) {
    const name = row.querySelector("strong")!.textContent!;
    const avatar = row.querySelector<HTMLElement>(".apartments-avatar")!;
    check(
      avatar.dataset.avatarSource === EXPECTED[name]?.source,
      `${name}: avatar from ${avatar.dataset.avatarSource}`,
    );
    check(
      avatar.title === EXPECTED[name]?.title,
      `${name}: title "${avatar.title}"`,
    );
    checkAvatar(avatar, name, false);
    check(
      inside(avatar.getBoundingClientRect(), row.getBoundingClientRect()),
      `${name}: avatar outside its row`,
    );
    const text = row.querySelector(".apartments-row-body")!;
    check(
      text.getBoundingClientRect().left >= avatar.getBoundingClientRect().right,
      `${name}: its text runs under its avatar`,
    );
  }
  // ada keeps her table's orange; turing has no colour and shows the accent.
  check(
    getComputedStyle(rows()[0]!.querySelector(".apartments-avatar")!)
      .backgroundColor === "rgb(154, 117, 85)",
    "ada: not on her colour",
  );
  check(
    dialog.scrollWidth <= dialog.clientWidth + 1 &&
      document.documentElement.scrollWidth <= window.innerWidth,
    "the list is wider than the window",
  );
  if (opened) {
    rows()
      .find((row) => row.querySelector("strong")!.textContent === opened)!
      .click();
    await until(
      () => !!document.querySelector(".apartments-detail-head"),
      "the resident view",
    );
    await frame();
    const head = document.querySelector<HTMLElement>(
      ".apartments-detail-head",
    )!;
    const avatar = head.querySelector<HTMLElement>(".apartments-avatar")!;
    checkAvatar(avatar, `${opened} opened`, true);
    check(
      avatar.dataset.avatarSource === EXPECTED[opened]?.source,
      `${opened} opened: avatar from ${avatar.dataset.avatarSource}`,
    );
    const name = head.querySelector("h2")!.getBoundingClientRect();
    check(
      name.left >= avatar.getBoundingClientRect().right,
      `${opened} opened: its name runs under its avatar`,
    );
    check(
      document.documentElement.scrollWidth <= window.innerWidth,
      "the resident view is wider than the window",
    );
  }
}

run()
  .catch((error) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
  );
