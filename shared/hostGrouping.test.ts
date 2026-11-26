import { expect, test } from "bun:test";
import {
  deriveHostGrouping,
  endpointAnchors,
  type GroupingProfile,
  groupingHosts,
  hostEndpoints,
  parseHostGrouping,
} from "./hostGrouping";

const local = (
  id: string,
  details: Partial<GroupingProfile> = {},
): GroupingProfile => ({
  id,
  label: id,
  type: "local",
  control_socket_path: "/tmp/example-control.sock",
  client_socket_path: "/tmp/example-client.sock",
  ...details,
});
const remote = { type: "ssh", ssh_destination: "box.example.test" };
const core = (
  id: string,
  details: Partial<GroupingProfile> = {},
): GroupingProfile => ({
  id,
  label: id,
  type: "local",
  core_state_dir: "",
  core_session: "default",
  ...details,
});
const live = () => false;

test("Herdr TUI connections first, then cores; a core ID the TUI lists stays the TUI's", () => {
  const hosts = groupingHosts(
    [local("tui"), local("box", remote), local("old", { type: undefined })],
    [core("tui"), core("local-core"), core("box-core", remote)],
  );
  expect(
    hosts.map(({ id, runtime, machine }) => [id, runtime, machine]),
  ).toEqual([
    ["tui", "herdr", "local"],
    ["box", "herdr", "ssh:box.example.test"],
    ["old", "herdr", "connection:old"],
    ["local-core", "herdr-core", "local"],
    ["box-core", "herdr-core", "ssh:box.example.test"],
  ]);
});

test("one group per machine holding each runtime, or one per runtime, in World's order", () => {
  const hosts = groupingHosts(
    [local("box", remote), local("tui", { label: "Studio", is_default: true })],
    [core("local-core"), core("box-core", remote)],
  );
  const byMachine = deriveHostGrouping(hosts, "machine", live);
  expect(byMachine.grouping).toBe("machine");
  expect(
    byMachine.groups.map((group) => [
      group.key,
      group.label,
      group.members.map((member) => member.connection_id),
    ]),
  ).toEqual([
    ["local", "Studio", ["tui", "local-core"]],
    ["ssh:box.example.test", "box", ["box", "box-core"]],
  ]);
  const byRuntime = deriveHostGrouping(hosts, "runtime", live);
  // The startup default first, then by name: the order World lists hosts in.
  expect(byRuntime.groups.map((group) => group.key)).toEqual([
    "runtime:tui",
    "runtime:box",
    "runtime:box-core",
    "runtime:local-core",
  ]);
  expect(byRuntime.groups[3]!.members).toEqual([
    { connection_id: "local-core", runtime: "herdr-core", label: "local-core" },
  ]);
});

test("a missing or unknown setting groups by machine", () => {
  const hosts = groupingHosts([local("tui")]);
  expect(deriveHostGrouping(hosts, undefined, live).grouping).toBe("machine");
  expect(deriveHostGrouping(hosts, "galaxy", live).grouping).toBe("machine");
});

test("duplicate endpoints: one anchor from profiles alone, a live view shown while it is stale", () => {
  const hosts = groupingHosts([
    local("startup-default", { read_only: true }),
    local("saved"),
    local("other", { client_socket_path: "/tmp/other-client.sock" }),
    local("ssh-a", {
      ...remote,
      remote_control_socket_path: "/tmp/c.sock",
      remote_client_socket_path: "/tmp/k.sock",
    }),
    local("ssh-b", {
      ...remote,
      remote_control_socket_path: "/tmp/c.sock",
      remote_client_socket_path: "/tmp/k.sock",
    }),
    local("ssh-other", {
      ssh_destination: "two.example.test",
      type: "ssh",
      remote_control_socket_path: "/tmp/c.sock",
      remote_client_socket_path: "/tmp/k.sock",
    }),
  ]);
  // The first writable view anchors; the read-only default does not.
  expect(hostEndpoints(hosts, live)).toEqual([
    { views: ["startup-default", "saved"], anchor: "saved", shown: "saved" },
    { views: ["ssh-a", "ssh-b"], anchor: "ssh-a", shown: "ssh-a" },
  ]);
  // The anchor goes stale: the live view is shown, the anchor is kept.
  const stale = new Set(["saved", "ssh-a", "ssh-b"]);
  expect(hostEndpoints(hosts, (id) => stale.has(id))).toEqual([
    {
      views: ["startup-default", "saved"],
      anchor: "saved",
      shown: "startup-default",
    },
    // Every view stale: the anchor stays shown.
    { views: ["ssh-a", "ssh-b"], anchor: "ssh-a", shown: "ssh-a" },
  ]);
  // It reconnects: shown again.
  expect(hostEndpoints(hosts, live)[0]!.shown).toBe("saved");
});

test("two core profiles of one session are one endpoint; another session is apart", () => {
  const hosts = groupingHosts(
    [],
    [core("a"), core("b"), core("c", { core_session: "other" })],
  );
  expect(hostEndpoints(hosts, live)).toEqual([
    { views: ["a", "b"], anchor: "a", shown: "a" },
  ]);
});

test("endpoint anchors map each non-anchor view, once per publication", () => {
  const grouping = deriveHostGrouping(
    groupingHosts([local("default", { read_only: true }), local("saved")]),
    "machine",
    live,
  );
  const anchors = endpointAnchors(grouping);
  expect([...anchors]).toEqual([["default", "saved"]]);
  expect(endpointAnchors(grouping)).toBe(anchors);
  expect(endpointAnchors(undefined).size).toBe(0);
});

test("a published grouping parses back; malformed entries are dropped and lists bounded", () => {
  const grouping = deriveHostGrouping(
    groupingHosts([local("default"), local("saved")], [core("core")]),
    "runtime",
    live,
  );
  expect(parseHostGrouping(JSON.parse(JSON.stringify(grouping)))).toEqual(
    grouping,
  );
  expect(parseHostGrouping(null)).toBeNull();
  expect(
    parseHostGrouping({ grouping: "galaxy", groups: [], endpoints: [] }),
  ).toBeNull();
  expect(
    parseHostGrouping({
      grouping: "machine",
      groups: [
        { key: "local", label: "x", members: [{ connection_id: "a" }] },
        {
          key: "ok",
          label: "ok",
          members: [{ connection_id: "b", runtime: "herdr", label: "b" }],
        },
        ...Array.from({ length: 600 }, (_, i) => ({
          key: `k${i}`,
          label: "",
          members: [{ connection_id: `c${i}`, runtime: "herdr", label: "" }],
        })),
      ],
      endpoints: [
        { views: ["a"], anchor: "a", shown: "a" },
        { views: ["a", "b"], anchor: "c", shown: "a" },
        { views: ["a", "b"], anchor: "b", shown: "a" },
      ],
    }),
  ).toMatchObject({
    groups: expect.arrayContaining([
      { key: "ok", label: "ok", members: [expect.anything()] },
    ]),
    endpoints: [{ views: ["a", "b"], anchor: "b", shown: "a" }],
  });
  const parsed = parseHostGrouping({
    grouping: "machine",
    groups: Array.from({ length: 600 }, (_, i) => ({
      key: `k${i}`,
      label: "",
      members: [{ connection_id: `c${i}`, runtime: "herdr", label: "" }],
    })),
    endpoints: [],
  });
  expect(parsed?.groups.length).toBe(512);
});

test("a group is named and ordered after the runtime standing for its endpoint", () => {
  const grouping = deriveHostGrouping(
    groupingHosts([
      local("startup", { label: "Studio", read_only: true, is_default: true }),
      local("saved", { label: "Saved profile" }),
      local("box", { ...remote, label: "Box" }),
    ]),
    "machine",
    live,
  );
  expect(grouping.groups.map(({ key, label }) => [key, label])).toEqual([
    ["ssh:box.example.test", "Box"],
    ["local", "Saved profile"],
  ]);
  // Members stay in World's order: the startup default first.
  expect(grouping.groups[1]!.members.map((each) => each.label)).toEqual([
    "Studio",
    "Saved profile",
  ]);
});

test("the replica keeps a machine group of every profile plus the startup default", () => {
  const profiles = Array.from({ length: 65 }, (_, index) =>
    local(`p${index}`, { client_socket_path: `/tmp/example-${index}.sock` }),
  );
  const grouping = deriveHostGrouping(groupingHosts(profiles), "machine", live);
  const parsed = parseHostGrouping(JSON.parse(JSON.stringify(grouping)));
  expect(parsed?.groups).toHaveLength(1);
  expect(parsed?.groups[0]!.members).toHaveLength(65);
});
