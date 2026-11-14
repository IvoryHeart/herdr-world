import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  type CoreConnectionSummary,
  parseCoreConnections,
} from "../coreConnections";
import { CoreConnectionCards } from "./CoreConnections";

const connection = (
  overrides: Record<string, unknown>,
  stops: unknown,
): CoreConnectionSummary =>
  parseCoreConnections([
    {
      id: "box-core",
      label: "Box core",
      type: "local",
      runtime: "herdr-core",
      state: "ready",
      generation: 1,
      core_session: "default",
      core_state_dir: "",
      observation: {
        state: "live",
        reason: null,
        core: { id: "c0ffee", name: "example-host", version: "0.1.21", pid: 7 },
        observed_ms: 1,
        terminals: [],
        counts: { live: 0, finished: 0, remote: 0 },
        unknown_events: [],
        stops_at_logout: stops,
      },
      ...overrides,
    },
  ])[0]!;

const render = (connections: CoreConnectionSummary[]) =>
  renderToStaticMarkup(
    createElement(CoreConnectionCards, {
      connections,
      pending: null,
      act() {},
      onRemove() {},
    }),
  );

test("a core whose programs stop at logout warns with the one fix command", () => {
  const local = render([connection({}, { linger_user: "example-user" })]);
  expect(local).toContain("stops at logout");
  expect(local).toContain(
    "Programs on this computer stop when your last login there ends.",
  );
  expect(local).toContain(
    "<code>sudo loginctl enable-linger -- example-user</code>",
  );
  const ssh = render([
    connection(
      { type: "ssh", ssh_destination: "dev@example.test" },
      { linger_user: null },
    ),
  ]);
  expect(ssh).toContain("Programs on dev@example.test stop");
  expect(ssh).toContain("sudo loginctl enable-linger -- &lt;user&gt;");
});

test("kept running or unknown shows nothing", () => {
  for (const stops of [null, undefined]) {
    const markup = render([connection({}, stops)]);
    expect(markup).not.toContain("logout");
    expect(markup).not.toContain("loginctl");
  }
});
