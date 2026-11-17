import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConnectionSummary } from "../api";
import { HostsControl } from "./HostsControl";

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
  const markup = renderToStaticMarkup(
    <HostsControl
      connections={connections}
      ids={connections.map(({ id }) => id)}
      explanation=""
      onChange={() => {}}
    />,
  );
  expect(markup).toContain('title="Hosts (2)"');
  expect(markup).toContain('class="world-hosts-count">2</span>');
  expect(markup).toContain('class="connection-switcher-label">2 hosts</span>');
});
