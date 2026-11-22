import { afterEach, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SHIPYARD_LIMITS as L } from "../../../shared/shipyard";
import { ShipyardInstances } from "./instances";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const identity = {
  generation: "11111111-1111-4111-8111-111111111111",
  version: "1.0.0",
  repo: "example-org/widgets",
  branch: "preview/widgets",
  sha: "a".repeat(40),
  kind: "source" as const,
  startedAt: 1_000,
};
function setup() {
  const root = mkdtempSync(join(tmpdir(), "shipyard-instances-"));
  roots.push(root);
  const directory = join(root, "registry");
  let now = 10_000,
    scheduled: (() => void) | null = null;
  const registry = new ShipyardInstances(directory, root, () => now, {
    schedule: (callback) => {
      scheduled = callback;
      return {
        cancel() {
          scheduled = null;
        },
      };
    },
  });
  return {
    registry,
    directory,
    advance: (ms: number) => {
      now += ms;
    },
    renew: () => scheduled?.(),
    root,
  };
}

test("listening reports are private, renew, expire without actions and revoke on stop", () => {
  const { registry, directory, root, advance, renew } = setup();
  registry.start(identity, 19091, "127.0.0.1", false);
  const file = join(directory, readdirSync(directory)[0]!);
  if (process.platform !== "win32") {
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
  }
  expect(readFileSync(file, "utf8")).not.toContain(root);
  expect(registry.read().items[0]!.openUrl).toBe("http://127.0.0.1:19091/");
  advance(30_000);
  renew();
  advance(30_000);
  expect(registry.read().items[0]!.state).toBe("fresh");
  advance(L.instanceLeaseMs);
  expect(registry.read().items[0]!.openUrl).toBeNull();
  expect(registry.read().items[0]!.state).toBe("stale");
  registry.stop();
  expect(registry.read().items).toEqual([]);
});

test("non-loopback-only listeners never advertise a guessed address", () => {
  const { registry } = setup();
  registry.start(identity, 19091, "192.0.2.1", true);
  expect(registry.read().items[0]!.openUrl).toBeNull();
  registry.stop();
});

test("IPv6 listeners advertise only their own loopback family", () => {
  const { registry } = setup();
  registry.start(identity, 19091, "::1", true);
  expect(registry.read().items[0]!.openUrl).toBe("https://[::1]:19091/");
  registry.stop();
});

test("isolated data folders share only explicitly selected instance observations", () => {
  const { registry, directory, root } = setup();
  const peer = new ShipyardInstances(
    directory,
    join(root, "peer-data"),
    () => 10_000,
    { schedule: () => ({ cancel() {} }) },
  );
  registry.start(identity, 19091, "127.0.0.1", false);
  peer.start(
    { ...identity, generation: "22222222-2222-4222-8222-222222222222" },
    19092,
    "127.0.0.1",
    false,
  );
  expect(registry.read().items).toHaveLength(2);
  expect(peer.read().items).toHaveLength(2);
  registry.stop();
  expect(peer.read().items).toHaveLength(1);
  expect(peer.read().items[0]!.port).toBe(19092);
  peer.stop();
});

test("malformed, future and symlinked records are bounded and non-actionable", () => {
  const { registry, directory } = setup();
  registry.start(identity, 19091, "127.0.0.1", false);
  const file = join(directory, readdirSync(directory)[0]!);
  const report = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(
    file,
    JSON.stringify({
      ...report,
      reportedAt: 100_000_000,
      expiresAt: 100_045_000,
      secret: "private",
    }),
  );
  expect(registry.read().items).toEqual([]);
  expect(registry.read().complete).toBe(false);
  writeFileSync(file, JSON.stringify({ ...report, secret: "private" }));
  expect(JSON.stringify(registry.read())).not.toContain("private");
  if (process.platform !== "win32") {
    symlinkSync(file, join(directory, `${"f".repeat(24)}.json`));
    expect(registry.read().items.length).toBe(1);
    expect(registry.read().complete).toBe(false);
  }
  for (let index = 0; index < L.instances + 1; index++)
    writeFileSync(
      join(directory, `${index.toString(16).padStart(24, "0")}.json`),
      "{}",
    );
  expect(registry.read().items.length).toBeLessThanOrEqual(L.instances);
  expect(registry.read().complete).toBe(false);
  registry.stop();
});
