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
        core: { id: "c0ffee", name: "example-host", version: "0.1.22", pid: 7 },
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

const offers = (markup: string) =>
  markup.match(/>Install herdr-core…<\/button>/g)?.length ?? 0;

test("a core that found nothing running offers the install; connecting alone never installs", () => {
  const missing = render([
    connection(
      {
        type: "ssh",
        ssh_destination: "dev@example.test",
        state: "error",
        error: { code: "core_missing", message: "herdr-core was not found" },
        observation: null,
      },
      null,
    ),
  ]);
  // The card and the host list each offer it; the host list also has this computer.
  expect(missing).toContain("herdr-core was not found");
  expect(missing).toContain('aria-label="Install herdr-core"');
  expect(missing).toContain("This computer");
  expect(offers(missing)).toBe(3);
  const windows = render([
    connection(
      {
        type: "ssh",
        ssh_destination: "win@example.test",
        remote_platform: "windows",
        state: "error",
        error: { code: "core_missing", message: "herdr-core was not found" },
        observation: null,
      },
      null,
    ),
  ]);
  expect(windows).not.toContain("win@example.test</span>");
  expect(offers(windows)).toBe(1);
});

test("a ready local core leaves only the hosts that still lack one", () => {
  const ready = render([connection({}, null)]);
  expect(ready).not.toContain("This computer");
  expect(offers(ready)).toBe(0);
  expect(offers(render([]))).toBe(1);
});
