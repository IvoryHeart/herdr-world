import { describe, expect, test } from "bun:test";
import { localAddress } from "./client";
import { coreClaimInEnvironment } from "./cli-claim";
import { CORE_SPAWNED_BY_LABEL, coreSpawnedBy } from "./labels";
import { CoreMirror } from "./mirror";
import { FakeCore } from "./testing/fake-core";
import { fakeCoreAddress } from "./testing/fake-address";
import source from "./testing/recorded/core-addresses.json";

const record = (address: string) => ({
  address,
  labels: {},
  argv: ["claude"],
  state: "live",
  pid: 100,
});

describe("native core addresses from official source", () => {
  test("client, labels and environment claims accept every source vector", () => {
    expect(source.vectors).toHaveLength(46);
    for (const { address } of source.vectors) {
      expect(localAddress(address)).toBe(address);
      expect(
        coreSpawnedBy({ labels: { [CORE_SPAWNED_BY_LABEL]: address } }),
      ).toBe(address);
      expect(
        coreClaimInEnvironment({
          HC_TERMINAL_ID: address,
          HC_TERMINAL_SOCKET: "/synthetic/core.sock",
        }),
      ).toEqual({ address, socket: "/synthetic/core.sock" });
    }
  });

  test("mirror refuses malformed native and linked addresses", () => {
    for (const address of [
      ...source.invalid,
      "bad name/t1b",
      "/t1b",
      "box//t1b",
      `${"x".repeat(65)}/t1b`,
    ]) {
      const mirror = new CoreMirror();
      expect(mirror.baseline(0, [record(address)])).toBe(false);
      expect(mirror.actionable).toBe(false);
    }
  });

  test("local callers still refuse invalid IDs, linked machines and relative sockets", () => {
    for (const address of [
      ...source.invalid,
      "box/t1b",
      "box/nested/t1b",
      "../t1b",
      "/t1b",
      "t1b ",
      "t1b\n",
      `t1${"b".repeat(200)}`,
    ]) {
      expect(() => localAddress(address)).toThrow();
      expect(
        coreSpawnedBy({ labels: { [CORE_SPAWNED_BY_LABEL]: address } }),
      ).toBeNull();
      expect(
        coreClaimInEnvironment({
          HC_TERMINAL_ID: address,
          HC_TERMINAL_SOCKET: "/synthetic/core.sock",
        }),
      ).toBeNull();
    }
    expect(
      coreClaimInEnvironment({
        HC_TERMINAL_ID: "t1b",
        HC_TERMINAL_SOCKET: "relative.sock",
      }),
    ).toBeNull();
  });

  test("mirror admits native baselines, deltas and linked observations", () => {
    const mirror = new CoreMirror();
    expect(mirror.baseline(0, [record("t19"), record("box/t1b")])).toBe(true);
    expect(mirror.terminal("box/t1b")?.remote).toBe(true);
    expect(
      mirror.apply({
        method: "event",
        params: {
          seq: 1,
          type: "created",
          terminal: "t1b",
          data: record("t1b"),
        },
      }),
    ).toBe("applied");
    expect(mirror.terminal("t1b")?.remote).toBe(false);
    const occupancy = mirror.occupancy("t1b");
    expect(
      mirror.apply({
        method: "missed",
        params: { seq: 5, terminals: [record("t1b"), record("box/t1z")] },
      }),
    ).toBe("applied");
    expect(mirror.occupancy("t1b")).toBe(occupancy);
    expect(mirror.actionable).toBe(true);
    expect(
      mirror.apply({
        method: "event",
        params: {
          seq: 6,
          type: "restarted",
          terminal: "t1b",
          data: { ...record("t1b"), pid: 101 },
        },
      }),
    ).toBe("applied");
    expect(mirror.occupancy("t1b")).not.toBe(occupancy);
  });

  test("fake allocation follows the source alphabet across t19 to t1b and rollovers", () => {
    for (const { ordinal, address } of source.vectors)
      expect(fakeCoreAddress(ordinal)).toBe(address);
    for (const ordinal of [0, -1, 1.5, 0x1_0000_0000])
      expect(() => fakeCoreAddress(ordinal)).toThrow();
    const fake = new FakeCore();
    const expected = new Map(
      source.vectors.map(({ ordinal, address }) => [ordinal, address]),
    );
    for (let ordinal = 1; ordinal <= 8380; ordinal++) {
      const address = fake.create();
      if (expected.has(ordinal)) expect(address).toBe(expected.get(ordinal)!);
      fake.remove(address);
    }
  });
});
