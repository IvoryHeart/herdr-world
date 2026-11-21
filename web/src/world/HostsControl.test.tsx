import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConnectionSummary } from "../api";
import { worldHostGroups, type HostCatalogueEntry } from "../hostGroups";
import {
  HostsControl,
  HostsFilterOptions,
  hostsSelectionLabel,
  toggledHostIds,
} from "./HostsControl";

const connection = (
  id: string,
  extra: Partial<ConnectionSummary> = {},
): ConnectionSummary => ({
  id,
  label: id,
  source: "test",
  is_default: id === "tui",
  generation: 7,
  state: "ready",
  type: "local",
  ...extra,
});

const entry = (
  id: string,
  label: string,
  connectionIds: string[],
  extra: Partial<HostCatalogueEntry> = {},
): HostCatalogueEntry => ({
  id,
  label,
  type: id === "host-local" ? "local" : "ssh",
  windows: false,
  state: connectionIds.length ? "ready" : "empty",
  discovery: "complete",
  connectionIds,
  installable: [],
  ...extra,
});

// Two runtimes on this computer and one remote host: the real shape.
const hosts = worldHostGroups({
  connections: [
    connection("tui"),
    connection("remote", { type: "ssh", ssh_destination: "dev.example.test" }),
  ],
  coreConnections: [
    {
      id: "core",
      label: "Synthetic core",
      type: "local",
      runtime: "herdr-core",
      state: "ready",
      generation: 2,
      core_session: "",
      core_state_dir: "",
      auto_connect: true,
      read_only: false,
    },
  ],
  hostCatalogue: [
    entry("host-local", "This computer", ["tui", "core"]),
    entry("host-remote", "dev.example.test", ["remote"]),
    entry("host-empty", "spare.example.test", [], {
      installable: [{ kind: "herdr-core", label: "herdr-core" }],
    }),
  ],
});

test("the Hosts trigger counts machines, not runtimes", () => {
  const markup = renderToStaticMarkup(
    <HostsControl
      hosts={hosts}
      ids={["core"]}
      explanation=""
      onChange={() => {}}
    />,
  );
  expect(markup).toContain('title="Hosts (3)"');
  expect(markup).toContain('class="world-hosts-count">3</span>');
  // Ticking only the core runtime still shows the whole machine.
  expect(markup).toContain('class="connection-switcher-label">1 host</span>');
});

test("one row and one tick per host; runtimes are not told apart", () => {
  const markup = renderToStaticMarkup(
    <HostsFilterOptions
      hosts={hosts}
      ids={null}
      onChange={() => {}}
      onManage={() => {}}
    />,
  );
  expect(markup.match(/type="checkbox"/g)).toHaveLength(3);
  expect(markup).toContain("This computer · ready");
  expect(markup).toContain("dev.example.test · ready");
  expect(markup).not.toContain("herdr-core ·");
  expect(markup).not.toContain("Synthetic core");
  // An empty host says so and offers to add a runtime.
  expect(markup).toContain("spare.example.test · No runtime found");
  expect(markup).toContain('aria-label="Add a runtime to spare.example.test"');
});

test("a tick covers every runtime of its host", () => {
  const local = hosts[0]!;
  const remote = hosts[1]!;
  expect(toggledHostIds(hosts, null, remote, false)).toEqual(["tui", "core"]);
  expect(toggledHostIds(hosts, ["remote"], local, true)).toEqual([
    "remote",
    "tui",
    "core",
  ]);
  // An older stored tick of one runtime selects the whole host.
  expect(toggledHostIds(hosts, ["core"], local, false)).toEqual([]);
  expect(hostsSelectionLabel(hosts, ["tui", "remote"])).toBe("2 hosts");
  expect(hostsSelectionLabel(hosts, null)).toBe("All hosts");
});

test("without a host catalogue, each runtime endpoint is its own host", () => {
  const groups = worldHostGroups({
    connections: ["default", "local", "remote"].map((id) =>
      connection(id, {
        type: id === "remote" ? "ssh" : "local",
        control_socket_path: "/tmp/example-control.sock",
        client_socket_path: "/tmp/example-client.sock",
      }),
    ),
  });
  const markup = renderToStaticMarkup(
    <HostsControl
      hosts={groups}
      ids={["default", "local", "remote"]}
      explanation=""
      onChange={() => {}}
    />,
  );
  // "default" and "local" share an endpoint: one host.
  expect(markup).toContain('title="Hosts (2)"');
  expect(markup).toContain('class="connection-switcher-label">2 hosts</span>');
});
