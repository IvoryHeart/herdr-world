import { expect, test } from "bun:test";
import {
  emptyServerSessionState,
  store,
  type State,
  type ServerSessionState,
} from "../store";
import { officeCreationInputsEqual } from "./officeCreationInputs";

test("unattached hosts do not invalidate creation inputs on unrelated updates", () => {
  const previous = {
    ...store.get(),
    activeConnectionId: "unrelated",
    sessionsByConnectionId: {},
  };
  const next = { ...previous, lastRefresh: previous.lastRefresh + 1 };
  expect(
    officeCreationInputsEqual(previous, next, [{ connectionId: "cached" }]),
  ).toBe(true);
});

test("navigation and endpoint changes still invalidate creation inputs", () => {
  const session = {
    ...emptyServerSessionState(7),
    navigationMode: "browser-local" as const,
  };
  const previous = {
    ...store.get(),
    activeConnectionId: "unrelated",
    sessionsByConnectionId: { alpha: session },
  } as State;
  const hosts = [{ connectionId: "alpha" }];
  const changed = (patch: Partial<ServerSessionState>) => ({
    ...previous,
    sessionsByConnectionId: { alpha: { ...session, ...patch } },
  });
  expect(officeCreationInputsEqual(previous, changed({}), hosts)).toBe(true);
  const active = { ...previous, ...session, activeConnectionId: "alpha" };
  expect(
    officeCreationInputsEqual(
      active,
      { ...active, endpointAvailability: {} },
      hosts,
    ),
  ).toBe(false);
  for (const patch of [
    { navigationMode: "shared" as const },
    { workspaces: [] },
    { panes: [] },
    { endpointAvailability: {} },
    { browserNavigation: { ...session.browserNavigation } },
  ])
    expect(officeCreationInputsEqual(previous, changed(patch), hosts)).toBe(
      false,
    );
});
