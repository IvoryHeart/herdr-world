import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConnectionSummary } from "../api";
import { type CoreConnectionProfileSummary, worldHosts } from "../worldHosts";
import { HostsControl } from "./HostsControl";
import { publishHostGroupingOf } from "./testing/publishedHostGrouping";

test("selected host label and badge count matching endpoints consistently", () => {
  const connections: ConnectionSummary[] = ["default", "local", "remote"].map(
    (id) => ({
      id,
      label: id,
      source: "test",
      is_default: id === "default",
      generation: 7,
      state: "ready",
      type: id === "remote" ? "ssh" : "local",
      control_socket_path: "/tmp/example-control.sock",
      client_socket_path: "/tmp/example-client.sock",
    }),
  );
  // World groups this computer's two connections of one socket together.
  const restore = publishHostGroupingOf(() => ({ connections }));
  const markup = renderToStaticMarkup(
    <HostsControl
      connections={worldHosts({ connections })}
      ids={connections.map(({ id }) => id)}
      explanation=""
      onChange={() => {}}
    />,
  );
  expect(markup).toContain('title="Hosts (2)"');
  expect(markup).toContain('class="world-hosts-count">2</span>');
  expect(markup).toContain('class="connection-switcher-label">2 hosts</span>');
  restore();
});

test("a herdr-core host is listed with its runtime and counted", () => {
  const catalogue: {
    connections: ConnectionSummary[];
    coreConnections: CoreConnectionProfileSummary[];
  } = {
    connections: [
      {
        id: "tui",
        label: "Synthetic Herdr",
        source: "test",
        is_default: true,
        generation: 1,
        state: "ready",
      },
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
  };
  const hosts = worldHosts(catalogue);
  const restore = publishHostGroupingOf(() => catalogue);
  const markup = renderToStaticMarkup(
    <HostsControl
      connections={hosts}
      ids={["core"]}
      explanation=""
      onChange={() => {}}
    />,
  );
  expect(markup).toContain('class="connection-switcher-label">1 hosts</span>');
  expect(markup).toContain('title="Hosts (2)"');
  restore();
});
