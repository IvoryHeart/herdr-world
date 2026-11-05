import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorldRuntimeConnection } from "./runtimeStore";
import type { WorldObject } from "./worldObject";
import {
  localHerdrSetupOffer,
  TownHerdrSetupOffer,
  TownNoHosts,
  WorldWelcomeText,
} from "./WorldStatus";

function host(connection: Partial<WorldRuntimeConnection>) {
  return {
    connection: {
      connectionId: "local",
      label: "Local",
      source: "local",
      isDefault: true,
      state: "connecting",
      generation: 1,
      snapshotGeneration: null,
      stale: false,
      actionable: false,
      snapshot: null,
      ...connection,
    },
  };
}

function world(...hosts: ReturnType<typeof host>[]) {
  return { hosts } as unknown as WorldObject;
}

const refused = "connect ENOENT /tmp/example.sock";
const remote = { connectionId: "remote", isDefault: false };

test("Town offers local Herdr setup only for a failing default host with nothing ready", () => {
  const cases: [string, WorldObject, boolean][] = [
    ["error", world(host({ state: "error", error: refused })), true],
    [
      "reconnecting with an error",
      world(host({ state: "reconnecting", error: refused })),
      true,
    ],
    [
      "remote also failing",
      world(
        host({ state: "error", error: refused }),
        host({ ...remote, state: "error", error: "timeout" }),
      ),
      true,
    ],
    [
      "connecting without an error",
      world(host({ state: "connecting" })),
      false,
    ],
    [
      "explicitly disconnected without an error",
      world(host({ state: "disconnected" })),
      false,
    ],
    ["ready", world(host({ state: "ready" })), false],
    [
      "another host ready",
      world(
        host({ state: "error", error: refused }),
        host({ ...remote, state: "ready" }),
      ),
      false,
    ],
    [
      "no default host",
      world(host({ ...remote, state: "error", error: refused })),
      false,
    ],
    ["no hosts", world(), false],
  ];
  for (const [name, input, expected] of cases)
    expect([name, localHerdrSetupOffer(input)]).toEqual([name, expected]);
});

test("Town's setup offer renders nothing, and fetches nothing, when the gate is closed", () => {
  expect(
    renderToStaticMarkup(
      createElement(TownHerdrSetupOffer, {
        world: world(host({ state: "connecting" })),
      }),
    ),
  ).toBe("");
  // Open, the stage panel holds the existing card, which starts by checking.
  const open = renderToStaticMarkup(
    createElement(TownHerdrSetupOffer, {
      world: world(host({ state: "error", error: refused })),
    }),
  );
  expect(open).toContain('class="town-herdr-setup"');
  expect(open).toContain("Checking Herdr connection");
});

test("the welcome card names current views only", () => {
  // The switcher reads the live store; the card's words render on their own.
  const markup = renderToStaticMarkup(createElement(WorldWelcomeText));
  for (const view of ["Town", "Board", "Desk", "Spaces"])
    expect(markup).toContain(view);
  for (const retired of ["Office", "Tree", "Graph"])
    expect(markup).not.toContain(retired);
});

test("Town's no-hosts state points to Hosts → Manage connections", () => {
  const markup = renderToStaticMarkup(createElement(TownNoHosts));
  expect(markup).toContain("Hosts → Manage connections");
  expect(markup).not.toContain("Spaces");
});
