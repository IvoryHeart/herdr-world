import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  initializeLayoutPreferences,
  updateLayoutPreferences,
} from "./layoutPreferences";
import {
  pushRoute,
  stepBack,
  useSystemBack,
  type SystemBackLevel,
} from "./systemBack";

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

type Name = "terminal" | "composer" | "menu";
const levels: Record<Name, SystemBackLevel> = {
  terminal: "screen",
  composer: "panel",
  menu: "popup",
};
let open = new Set<Name>();
let closed: Name[] = [];
let root: Root;

// Composer is a child of the terminal, as in the app: React runs its effects
// first when both activate in one commit.
function Layer({ name, children }: { name: Name; children?: ReactNode }) {
  useSystemBack(
    open.has(name),
    () => {
      closed.push(name);
      show([...open].filter((candidate) => candidate !== name));
    },
    levels[name],
  );
  return <>{children}</>;
}

function show(names: Name[]) {
  open = new Set(names);
  flushSync(() =>
    root.render(
      <>
        <Layer name="terminal">
          <Layer name="composer" />
        </Layer>
        <Layer name="menu" />
      </>,
    ),
  );
}

const guarded = () =>
  typeof history.state === "object" &&
  history.state !== null &&
  "herdrBack" in history.state;
const at = () => location.pathname;
async function userBack() {
  history.back();
  await settle();
}
// Every case starts on /office, reached from /graph, with nothing open.
async function start() {
  show([]);
  await settle();
  history.pushState(null, "", "/graph");
  history.pushState(null, "", "/office");
  closed = [];
}

async function run() {
  initializeLayoutPreferences();
  updateLayoutPreferences({ mode: "mobile" });
  root = createRoot(document.body.appendChild(document.createElement("div")));

  {
    const label = "layers closed together";
    await start();
    show(["terminal", "composer"]);
    await settle();
    check(guarded(), `${label}: no guard while layers are open`);
    show([]);
    await settle();
    check(at() === "/office" && !guarded(), `${label}: guard left behind`);
    await userBack();
    check(at() === "/graph", `${label}: Back needed more than one press`);
  }

  {
    const label = "on-screen and system Back mixed";
    await start();
    show(["terminal"]);
    await settle();
    show(["terminal", "composer"]);
    await settle();
    await userBack();
    check(
      closed.join() === "composer" && open.has("terminal") && guarded(),
      `${label}: Back did not close only Composer: ${closed.join()}`,
    );
    show([]);
    await settle();
    check(at() === "/office" && !guarded(), `${label}: guard left behind`);
    await userBack();
    check(at() === "/graph", `${label}: Back did not reach the prior route`);

    await start();
    show(["terminal", "composer"]);
    await settle();
    show(["terminal"]);
    await settle();
    check(guarded(), `${label}: terminal lost its guard`);
    await userBack();
    check(
      closed.join() === "terminal" && at() === "/office" && !guarded(),
      `${label}: Back did not close the terminal`,
    );
    await userBack();
    check(at() === "/graph", `${label}: second Back did not leave Office`);
  }

  {
    // Browsers skip entries a page pushes without a user gesture, so a Back
    // must never push a guard: each layer's guard is pushed when it opens.
    const label = "Back pushes no history";
    await start();
    show(["terminal"]);
    await settle();
    show(["terminal", "composer"]);
    await settle();
    const realPush = history.pushState.bind(history);
    let pushes = 0;
    history.pushState = (...args: Parameters<History["pushState"]>) => {
      pushes += 1;
      realPush(...args);
    };
    await userBack();
    check(
      closed.join() === "composer" && open.has("terminal"),
      `${label}: first Back closed ${closed.join()}`,
    );
    await userBack();
    check(
      closed.join() === "composer,terminal" && at() === "/office",
      `${label}: second Back did not return to Office (${at()})`,
    );
    history.pushState = realPush;
    check(pushes === 0, `${label}: Back pushed ${pushes} history entries`);
    await userBack();
    check(at() === "/graph", `${label}: third Back did not leave Office`);
  }

  {
    const label = "layers registered together";
    await start();
    show(["terminal", "composer"]);
    await settle();
    updateLayoutPreferences({ mode: "desktop" });
    await settle();
    check(!guarded(), `${label}: desktop kept a guard`);
    updateLayoutPreferences({ mode: "mobile" });
    await settle();
    await userBack();
    check(
      closed.join() === "composer" && open.has("terminal"),
      `${label}: Back closed ${closed.join()} instead of Composer`,
    );
    show([]);
    await settle();
  }

  {
    const label = "layer opened while a Back is pending";
    await start();
    show(["menu"]);
    await settle();
    show([]);
    await Promise.resolve();
    show(["terminal"]);
    await settle();
    check(
      open.has("terminal") && guarded() && at() === "/office",
      `${label}: terminal closed or unguarded`,
    );
    await userBack();
    check(closed.join() === "terminal", `${label}: Back missed the terminal`);
    await userBack();
    check(at() === "/graph", `${label}: Back did not reach the prior route`);
  }

  {
    const label = "route opened from a layer";
    await start();
    show(["terminal"]);
    await settle();
    const url = new URL(location.href);
    url.pathname = "/spaces";
    pushRoute({ herdrFrom: "/office" }, url);
    show([]);
    await settle();
    check(at() === "/spaces" && !guarded(), `${label}: route not current`);
    await userBack();
    check(at() === "/office", `${label}: Back from the route went ${at()}`);
    await userBack();
    check(at() === "/graph", `${label}: Back stopped on a stale entry`);
  }

  {
    // Two layers leave a lower guard below a route opened from them. Back
    // skips it to the page; Forward must continue past it to the route.
    const label = "route opened from stacked layers";
    await start();
    show(["terminal"]);
    await settle();
    show(["terminal", "composer"]);
    await settle();
    // Three layers leave two guards below the route.
    show(["terminal", "composer", "menu"]);
    await settle();
    const url = new URL(location.href);
    url.pathname = "/spaces";
    pushRoute({ herdrFrom: "/office" }, url);
    show([]);
    await settle();
    check(at() === "/spaces", `${label}: route not current`);
    await userBack();
    check(
      at() === "/office" && !guarded(),
      `${label}: Back from the route reached ${at()}`,
    );
    history.forward();
    await settle();
    check(
      at() === "/spaces",
      `${label}: Forward from Office stayed at ${at()}`,
    );
    await userBack();
    check(at() === "/office", `${label}: second Back reached ${at()}`);
    await userBack();
    check(at() === "/graph", `${label}: Back did not leave Office`);
  }

  {
    // Two layers closed on screen leave two guards as Forward history.
    // Forward ends inside them; one Back then leaves the page.
    const label = "Forward ends in stacked leftover guards";
    await start();
    show(["terminal"]);
    await settle();
    show(["terminal", "composer"]);
    await settle();
    show([]);
    await settle();
    check(at() === "/office" && !guarded(), `${label}: guards left current`);
    history.forward();
    await settle();
    // Forward has nowhere real to go: it must not leave Office.
    check(at() === "/office", `${label}: Forward left Office for ${at()}`);
    await userBack();
    check(at() === "/graph", `${label}: Back after Forward reached ${at()}`);
  }

  {
    // A route chosen after Forward onto a leftover guard replaces it; Back
    // then returns to the page instead of skipping it.
    const label = "route chosen on a leftover guard";
    await start();
    show(["terminal"]);
    await settle();
    show([]);
    await settle();
    history.forward();
    await settle();
    const url = new URL(location.href);
    url.pathname = "/spaces";
    pushRoute({ herdrFrom: "/office" }, url);
    await settle();
    check(at() === "/spaces", `${label}: route not current`);
    await userBack();
    check(at() === "/office", `${label}: Back from the route reached ${at()}`);
    await userBack();
    check(at() === "/graph", `${label}: Back did not leave Office`);
  }

  {
    const label = "on-screen Back steps like system Back";
    await start();
    show(["terminal", "composer"]);
    await settle();
    check(stepBack(), `${label}: nothing to step back from`);
    await settle();
    check(
      closed.join() === "composer" && open.has("terminal") && guarded(),
      `${label}: closed ${closed.join()} instead of Composer`,
    );
    check(stepBack(), `${label}: terminal not closable`);
    await settle();
    check(
      closed.join() === "composer,terminal" && at() === "/office",
      `${label}: terminal did not close to Office`,
    );
    check(!stepBack(), `${label}: stepped back with nothing open`);
    await userBack();
    check(at() === "/graph", `${label}: Back did not reach the prior route`);
  }

  {
    const label = "unmount";
    await start();
    show(["terminal"]);
    await settle();
    root.unmount();
    await settle();
    check(guarded() && at() === "/office", `${label}: history moved`);
  }
}

run()
  .catch((error: unknown) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
  );
